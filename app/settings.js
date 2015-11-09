'use strict';

var path = require('path');

exports.UTIL_PATH = ".."
exports.IGNORED_PATTERNS =  /[\/\\]\./
exports.LISTS_PATH = path.resolve(__dirname, '../lists/');
exports.RESOURCES_PATH = path.resolve(__dirname, '../lists/resources_');
exports.ENV_FILE_PATH = path.resolve(__dirname, '../settings.env');
/* Not used, just to have the defaults handy.
DANDELION_USERNAME=yarilo
PASSWORD=test
SERVER_ADDRESS=http://54.175.16.89
SERVER_FOLDER=/Users/yarilolisure/PFC_TEST/
SERVER_PORT=80
SYNC_FREQ=80
HTTPS=false
*/
