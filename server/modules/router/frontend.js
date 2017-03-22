const express = require('express');
const path = require('path');

const publicPath = express.static('../frontend/dist');
const indexFile = path.join(__dirname, '../../../frontend/dist/index.html');

module.exports = {
    publicPath,
    indexFile
};