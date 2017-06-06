const express = require('express');
const api = require('modules/router/api');
const bodyParser = require('body-parser');
const logger = require('modules/middleware/logger');
const responseHandler = require('modules/middleware/response_handler');
const frontend = require('./frontend');
const user = require('./user');

const router = express.Router();

router.use(bodyParser.json());
router.use(bodyParser.urlencoded({ extended: true }));

//router.use('/', logger);

router.get('/', (req, res) => {
   res.sendFile(frontend.indexFile);
});

router.use('/dist', frontend.publicPath);

router.use('/api', api);

roter.user('/user', user);

router.use('/', responseHandler);

module.exports = router;
