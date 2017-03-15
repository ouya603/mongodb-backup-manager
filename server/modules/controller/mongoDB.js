const MongoClient = require('mongodb').MongoClient;
const databaseUtil = require('modules/utility/database');
const object = require('modules/utility/object');
const databaseConfig = require('modules/config').database;
const log = require('modules/utility/logger');


class MongoDB {

    constructor(server, port, username, password, auth_db='admin') {
        this.server = server;
        this.port = port;
        this.userName = username;
        this.password = password;
        this.authDB = auth_db;
        this.url = databaseUtil.getMongoUri(
            username,
            password,
            server,
            port,
            auth_db
        );
        this.db = null;
        this.backUpConfigCollection = null;
        this.dbHash = new Map();
    }

    connect() {
        return new Promise((resolve, reject) => {
            log.info(`connecting to database with ${ this.url }`);
            if(this.db) {
                return resolve();
            }

            MongoClient.connect(this.url)
                .then(db => {
                    log.info(`connected to the mongo DB at ${ this.server }`);
                    this.db = db;
                    resolve()
                })
                .catch(err => {
                    const errMessage = `Failed to connect to ${ server } for ${err.message}`;
                    log.error(errMessage);
                    reject(new Error(errMessage));
                });
        });
    }

    close() {
        if (this.db == null) {
            log.error('close failed: database is not connected');
                return;
            }

        this.db.close()
            .then(result => {
                log.info('successfully close the database');
                this.db = null;
                this.dbHash.clear();
            })
            .catch(err => {
                log.error(err.message);
            });
    }

    getUserRole() {
        return new Promise((resolve, reject) => {
            if (this.db == null) {
                return reject('database is not connected')
            }
            this.db.command({usersInfo: this.userName})
                .then(({users}) => {
                    if (users.length == 0) {
                        return reject(new Error(`no user ${this.userName} found`));
                    }

                    resolve(users[0]);
                })
                .catch(err => reject(err))
            }
        )
    }

    getAvailableDBsWithRoles(rolesFilter) {
        return new Promise((resolve, reject) => {
            this.getUserRole()
                .then(user => {
                    // log.info(user);
                    const databases = user.roles.filter(({role}) => rolesFilter.includes(role))
                        .map(({db}) => db);
                    resolve(databases);
                })
                .catch(err => reject(err));
        })
    }

    getAvailableDBsWithAdminDb() {
        return new Promise((resolve, reject) => {
            if (this.db == null) {
                return reject(new Error('database is not connected'));
            }

            const adminDb = this.db.admin();
            try {
                adminDb.listDatabases()
                    .then(({databases}) => {
                        resolve(databases.map(({name}) => name))
                    })
                    .catch(err => reject(err))
            } catch (err) {
                reject(err);
            }
        })
    }

    getAvailableDBs() {
        return new Promise((resolve, reject) => {
            if (this.db == null) {
                return reject(new Error('database is not connected'));
            }

            let promise = null;
            if (!this.userName) {
                promise = this.getAvailableDBsWithAdminDb()
            } else if (this.authDB == 'admin') {
                promise = this.getUserRole()
                    .then(user => {
                        const filterRoles = user.roles.filter(
                            ({role, db}) => (databaseConfig.all_database_backup_roles.includes(role)));
                        if (filterRoles.length > 0) {
                            return this.getAvailableDBsWithAdminDb();
                        } else {
                            return [];
                        }
                    })
            } else {
                promise = this.getAvailableDBsWithRoles(databaseConfig.database_backup_roles)
            }

            promise
                .then(dbs => resolve(dbs))
                .catch(err => reject(err))
        });
    }

    getCollectionNamesWithDB(db) {
        return new Promise((resolve, reject) => {
            this.getDB(db).listCollections().toArray()
                .then(collections => resolve(
                    // filter the system collections like system.user, system.profile
                    collections.filter(({ name }) => !name.match(/system\.[\w+]+/))
                        .map(({ name }) => name)
                ))
                .catch(err => reject(err));
        })
    }

    getAvailableBackupCollections() {
        return new Promise((resolve, reject) => {
            this.getAvailableDBs()
                .then(dbNames => {
                    return Promise.all(dbNames.map(
                        dbName => {
                            return new Promise((resolve, reject) => {
                                const newDb = this.getDB(dbName);
                                this.getCollectionNamesWithDB(newDb)
                                    .then(collections => resolve({db: dbName, collections}))
                                    .catch(err => reject(err));
                            });
                        }
                    ));
                })
                .then(dbCollections => {
                    return resolve(dbCollections)
                })
                .catch(err => {
                    return reject(err);
                });
        })
    }

    createBackupConfigCollection() {
        return new Promise((resolve, reject) => {
            const configDBName = databaseConfig.backup_config_db || 'backup_config';
            const backUpsConfigCollection = 'backup_configs';
            const configDB = this.getDB(configDBName);

            configDB.createCollection(backUpsConfigCollection)
                .then(collection => {
                    log.info('connected to mongo config collections');
                    this.backUpConfigCollection = collection;
                    resolve()
                })
                .catch(err => {
                    reject(new Error(
                        'created backup config collection failed for ' + err.message)
                    )
                })
        })
    }

    getBackUpConfig(backUpID) {
        return new Promise((resolve, reject) => {
            this.backUpConfigCollection.find({ id: backUpID })
                .toArray((err, backupConfigs) => {
                    if(err) {
                        return reject(err);
                    }
                    if(backupConfigs.length == 0) {
                        return reject(`Backup config for ${ backUpID } doesn't exist`);
                    }
                    resolve(backupConfigs[0]);
                })
        })
    }

    updateBackUpConfig(backUpConfig) {
        log.info(`updating backup config for ${ backUpConfig.id }`);
        return new Promise((resolve, reject) => {
            this.backUpConfigCollection.updateOne({ id: backUpConfig.id }, backUpConfig, { upsert: true, w: 1 })
                .then(result => {
                    log.info(`updated backup config of ${backUpConfig.id} successfully`);
                    resolve();
                })
                .catch(err => {
                    log.info(err);
                    log.error(`can't update backup config for ${backUpConfig.id}`);
                    reject(err);
                });
        })
    }

    readFromCollection(db, collectionName) {
        return new Promise((resolve, reject) => {
            this.getDB(db).collection(collectionName, {strict: false}, (err, collection) => {
                if(err) {
                    return reject(err);
                }
                collection.find({}).toArray((err, docs) => {
                    if(err) {
                        return reject(err);
                    }
                    resolve(docs);
                })
            })
        })
    }

    readFromCollections(db, collections) {
        return new Promise((resolve, reject) => {
            Promise.all(collections.map(collection => {
                return new Promise((resolve, reject) => {
                    this.readFromCollection(db, collection)
                        .then(docs => {
                            log.info(`Successfully read from ${collection} of ${db}`);
                            resolve({ collection, docs });
                        })
                        .catch(err => {
                            log.error(`Failed to read from ${collection} of ${db} for ${ err.message }`);
                            reject(err);
                        })
                })
            }).map(p => p.catch(e => e))
            ).then(collectionsDocs => {
                const errors = collectionsDocs.filter(collectionDocs => !collectionDocs.collection);
                if(errors.length > 0) {
                    log.error(`Failed to read all the data from ${ collections } of ${db} for ${errors[0].message}`)
                    return reject(errors[0])
                }
                log.info(`Finished read data from the ${ collections } of ${db}`);
                resolve(collectionsDocs);
            }).catch(err => {
                log.error(err);
                reject(err);
            })
        })
    }

    writeToCollections(db, collectionsDocs) {
        return new Promise((resolve, reject) => {
            Promise.all(collectionsDocs.map(collectionDocs => {
                return new Promise((resolve, reject) => {
                    const { collection, docs } = collectionDocs;
                    this.writeToCollection(db, collection, docs)
                        .then(() => resolve())
                        .catch(err => reject(err));
                })}).map(p => p.catch(e => e))
            ).then((results) => {
                const errors = results.filter(result => result);
                if(errors.length > 0) {
                    log.error(`Failed to backup all the data to ${ db } for ${errors[0].message}`);
                    return reject(errors[0])
                }
                log.info(`Successfully write all the data to ${ db }`);
                resolve();
            })
                .catch(err => {
                    log.error(`Failed to backup all the data to ${ db } for ${err.message}`);
                    reject(err)
                })
        })
    }

    writeToCollection(db, collectionName, docs) {
        return new Promise((resolve, reject) => {
            this.getDB(db).collection(collectionName, {strict: false},(err, collection) => {
                if(err) {
                    reject(err);
                }
                log.info(`${ collectionName } is empty`);
                if(docs.length == 0) {
                    this.getDB(db).createCollection(collectionName)
                        .then(() => {
                            log.info(`Successfully create empty ${ collectionName } in ${ db }`);
                            resolve();
                        })
                        .catch(err => {
                            log.error(`Failed to create empty ${ collectionName } in ${ db }`);
                            reject(err);
                        });
                }
                else {
                    collection.insertMany(docs)
                        .then(result => {
                            log.info(`Successfully write to ${ collectionName } of ${ db }`);
                            resolve();
                        })
                        .catch(err => {
                            log.error(`Failed write to ${ collectionName } of ${ db }`);
                            reject(err);
                        })
                }
            })
        })
    }

    deleteDatabase(db) {
        return new Promise((resolve, reject) => {
            this.getDB(db).dropDatabase()
                .then(result => {
                    resolve()
                })
                .catch(err => {
                    reject(err);
                })
        })
    }

    getDB(dbName) {
        if(!this.db) {
            log.error(`database is not connected`);
            return;
        }

        if(!this.dbHash.has(dbName)) {
            this.dbHash.set(dbName, this.db.db(dbName))
        }

        return this.dbHash.get(dbName);
    }
}

module.exports = MongoDB;
