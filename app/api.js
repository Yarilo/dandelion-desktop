'use strict';

require('prototypes');
var request = require('request');
var fs = require('fs-extra');
var pathLibrary = require('path');
var upath = require('upath');

function getCredentials()
{
	return "?user=" + process.env.DANDELION_USERNAME + "&token=" + process.env.TOKEN;
}
function getResourceURL(path)
{
	return process.env.SERVER_ADDRESS + '/api/resources/' + upath.normalizeSafe(path) + getCredentials();
}
function getDirectoryURL(path)
{
	return process.env.SERVER_ADDRESS + '/api/resources/dirs/' + upath.normalizeSafe(path) + getCredentials();
}

function getStateURL()
{
	return process.env.SERVER_ADDRESS + '/api/state/' + getCredentials();
}

function getAbsolutePath(path)
{
	var absolutePath = upath.normalizeSafe((process.env.SERVER_FOLDER + path));
	return absolutePath;
}
function getLoginURL()
{
	return process.env.SERVER_ADDRESS + '/api/login/';
}
exports.copyResource = function(origin, destination, callback)
{
	fs.copy(origin, destination,callback);
};
exports.login = function(callback)
{
	var options =
	{
		url: getLoginURL(),
		body: {'user': process.env.DANDELION_USERNAME,
			   'password': process.env.PASSWORD},
		json: true,
	};
	request.post(options, function(error, response, body)
	{
		if(error)
		{
			return callback("Error in login process: " + error);
		}
		if (response && response.statusCode != 200)
		{
			return callback("Error in login process: Status code" + response.statusCode);
		}
		process.env.TOKEN = body.token;
		process.env.DANDELION_USERNAME = body.username;
		console.log("Authenticated Successfully: ", process.env.TOKEN);
		return callback(null);
	});
};


exports.getServerFileList = function(callback)
{
	request.get(getStateURL(),function(error, response, body)
	{
		var serverList =[];
		if(error)
		{
			return callback(error);
		}
		if(body && response.statusCode == 200)
		{
			try
			{
				serverList = JSON.parse(body);
			}
			catch (exception)
			{
				return callback(exception, []);
			}
		}
		else if (response)
		{
				return callback("Error, response from server: " + response.statusCode, []);
		}
		return callback(error, serverList);
	});
};
//TODO: We do not support partial uploads yet.
//TODO: CU operations with server, review params
//TODO: Rename operations with server seems to not be respected
exports.uploadFile = function(path, callback)
{
	var options =
	{
		url: getResourceURL(path),
		headers: {
				'resource_kind': 'file',
				'owner': process.env.DANDELION_USERNAME,
				'mtime': Date.now(),
				'size':0,
			},
	};
	if (path.endsWith(pathLibrary.sep))
	{
		return callback(null);
	}
	fs.createReadStream(getAbsolutePath(path))
		.on('error',function(error)
		{
			return callback("Error reading file" + error);
		})
		.pipe(request.put(options))
		.on('response', function(response)
		{
			console.log('File', path, 'has been added');
			if(response.statusCode != 201)
			{
				console.log("status code uploading response", response.statusCode);
			}
			return callback(null);
		  })
		.on('error', function(error)
		{
			return callback("Error uploading file" + path + " : " + error);
		});
};

exports.getFile = function(path, callback)
{
	request(getResourceURL(path))
		.on('error', function(error)
		{
			return callback("Error getting file:" + path + " : " + error);
		})
		.pipe(fs.createWriteStream(getAbsolutePath(path)))
		.on('finish', function()
		{
			return callback(null);
		  })
		.on('error', function(err)
		{
			return callback("Error writing file:" + path + " : " + error);
		});
};


exports.deleteFile = function(path, callback)
{
	console.log("File", path, "has been deleted");
	var kind = "file";
	if (path.endsWith(pathLibrary.sep))
	{
		kind = "directory";
	}
	var options =
	{
		url: getResourceURL(path),
		headers: {
				'resource_kind': kind,
				'owner': process.env.DANDELION_USERNAME,
				'mtime': Date.now(),
				'size':'0',
			},
	};
	request.del(options,function(error, response, body)
	{
		if(error || response.statusCode != 204)
		{
			return callback("Error deleting from server:" + path + " : " + error + ":" + response.statusCode);
		}
		return callback(null);
	});
};
exports.addDirectory = function(path, callback)
{
	console.log('DIRECTORY', path, 'has been added');
	var options =
	{
		url: getDirectoryURL(path),
		headers: {
				'resource_kind': 'file',
				'owner': process.env.DANDELION_USERNAME,
				'mtime': Date.now(),
				'size':'0',
			},
	};
	request.put(options,function(error, response, body)
	{
		if(error || response.statusCode != 200)
		{
			return callback("Error adding to server:" + path + " : " + error);
		}
		return callback(null);
	});
};

exports.deleteDirectory = function(path, callback)
{
	console.log('Dir', path, 'has been deleted');
	path += "/"; //Needed as WebDAV spec
	exports.deleteFile(path, callback);
};

exports.deleteLocalFile = function (path, callback)
{
	fs.remove(getAbsolutePath(path), function (error)
	{
		if (error)
		{
			return callback("Error deleting file:" + path + " : " + error);
		}
		console.log('Successfully deleted', path);
		return callback(null);
	});
};

exports.deleteLocalDirectory = function (path, callback)
{
	fs.remove(getAbsolutePath(path), function (error)
	{
		  if (error)
		{
			return callback("Error deleting directory:" + path + " : " + error);
		}
		  console.log('Successfully deleted: ',path);
		  return callback(null);
	});
};

exports.createLocalDirectory = function(path, callback)
{
	fs.mkdir(getAbsolutePath(path), function(error){
		if (error)
		{
			console.log("Error making directory:", error);
			return callback("Error making directory:" + path + " : " + error);
		}
		console.log('Successfully added:', path);
		return callback(null);
	});
};

exports.handleError = function (error)
{
	console.log("Error happened", error);
};
