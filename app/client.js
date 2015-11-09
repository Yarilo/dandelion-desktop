'use strict';

require('prototypes');
var settings = require('./settings.js');
require('dotenv').config({path: settings.ENV_FILE_PATH});
var chokidar = require('chokidar');
var api = require('./api.js');
var fs = require('fs');
var pathLibrary = require('path');
var readdirp = require('readdirp');
var syncHandler;
var watcher;
var dialog = require('dialog');
var async = require('async');
var fs = require('fs-extra');
var pendingResources = {};
var ui = require('./main.js');
var conflictedResources = {};

function checkInitialSettings()
{
	if (!process.env.SERVER_FOLDER)
	{
		return false;
	}
	if (process.env.SERVER_FOLDER == pathLibrary.sep)
	{
		return false;
	}
	return true;
}
function checkOfflineChanges (callback)
{
	fs.readFile(settings.RESOURCES_PATH + process.env.DANDELION_USERNAME + ".json", function (error, data)
	 {

		 if (error)
		 {
			 return callback(error);
		 }
		var lastList = [];
		try
		{
			if (data)
			{
				lastList = JSON.parse(data);
			}
		}
		catch (exception)
		{
			console.log("Error generating last list, a new one will be generated, error: ", exception);
		}
		generateLocalFileList(function(error, newList)
		{
			if (error)
			{
				return callback("Error generating file system list" + error);
			}
			var diffList = compareLists(newList, lastList, true);
			diffList.changedFiles = generateChangedFiles(newList, lastList);
			console.log("LOCAL DIFF LIST", diffList);
			applyInitialChanges(diffList, function(error)
			{
				if(error)
				{
					return callback("Error applying initial changes to server" + error);
				}
				return callback(null);
			});
		});
	});
}

function checkChanged (callback)
{
	fs.readFile(settings.RESOURCES_PATH + process.env.DANDELION_USERNAME + ".json", function (error, data)
	 {
		if (error)
		{
			return callback(error);
		}
		var lastList = [];
		try
		{
			if(data)
			{
				lastList = JSON.parse(data);
			}
		}
		catch(exception)
		{
			console.log("Error generating last list, a new one will be generated: ", exception);
		}
		generateLocalFileList(function(error, newList)
		{
			if(error)
			{
				console.log("error generating file system list", error);
				return callback(error);
			}
			var changedFiles = generateChangedFiles(newList, lastList);
			changedFiles.forEach(function(resource)
			{
				pendingResources[resource.name] = {name: resource.name, task: 'change'};
			});
			return callback(null);
		});
	});
}

function generateChangedFiles (newList, oldList)
{
	var changedFiles = [];
	newList.forEach(function(resourceMaster)
	{
		if (isOnList(oldList, resourceMaster))
		{
			var hasBeenModified = oldList.some(function(resourceSlave)
			{
				if (resourceSlave.name === resourceMaster.name) //TODO Add mtime check also?
				{
					return  resourceMaster.size != resourceSlave.size;
				}
			});
			if(hasBeenModified)
			{
				changedFiles.push(resourceMaster);
			}
		}
	});
	return changedFiles;
}

exports.login = function(callback)
{
	api.login(callback);
};

/* 1. Read last generated list
*  2. Generate list
*  3. Compare
*  4. Apply changes
*  5. Set sync interval and start watcher.
*/
exports.start = function(callback)
{
		if (!checkInitialSettings())
		{
			dialog.showErrorBox("Error", "Error en la comprobación de la configuración inicial: La carpeta a sincronizar está vacía o no es válida.");
			return callback("Initial settings check failed");
		}
		ui.setTrayToolTip("Dandelion - Comprobando cambios offline");
		checkOfflineChanges(function(error)
		{
			if (error && error.code!=='ENOENT' && !error.contains('ENOENT'))
			{
				console.log(error);
				dialog.showErrorBox("Error", "Error generando la lista offline de cambios: " + error);
				return callback(error);
			}
			watchFS();
			startSync();
			return callback(null);
		});
};

exports.stop = function()
{
	if(watcher)
	{
		watcher.close();
		watcher = null;
	}
	clearInterval(syncHandler);
};
function stopSync()
{
	clearInterval(syncHandler);
}

function startSync()
{
	syncHandler = setInterval(function()
	{
		exports.sync();
	}, process.env.SYNC_FREQ*1000);
}
/*
 1. Stop sync to avoid sync interlaps
 2. Apply local fs changes on server.
 3. Get server list
 4. Get local list
 5. Compare them to obtain the diff list according to server
 6. Compare them to obtain the diff list according to client
 6. Resolve possible conflics (resources on two diffs) and get final list of server changes.
 7. Apply changes from server on local fs
 8. Start sync
*/

exports.sync = function()
{
	stopSync();
	ui.setTrayToolTip("Dandelion - Sincronizando");
	checkChanged(function(error)
	{
		if (error && error.code!=='ENOENT' && !error.contains('ENOENT'))
		{
			treatErrors("Error checking changed files list:" + error);
		}
		applyChangesOnServer(function(error)
		{
			if (error)
			{
				console.log("Error applying changes on server", error);
				treatErrors("Error applying changes on server" + error);
				return;
			}
			pendingResources = {};
			api.getServerFileList(function(error, serverList)
			{
				if(error)
				{
					console.log("Error getting server file list:",error);
					treatErrors("Error obteniendo la lista del servidor: " + error);
					return;
				}
				generateLocalFileList(function(error, clientList)
				{
					if(error)
					{
						console.log("Error generating file system list:", error);
						treatErrors("Error generando lista local: " + error);
						return;
					}
					var diffServerList = compareLists(serverList, clientList, false);
					var diffClientList = compareLists(clientList, serverList, false);
					var finalList = getFinalList(diffServerList, diffClientList);
					applyChangesOnLocal(finalList, function(error)
					{
						if(error)
						{
							console.log("Error applying local changes on fs", error);
							treatErrors("Error aplicando cambios locales: " + error);
							return;
						}
						generateLocalFileList(function(error, clientList)
						{
							if(error)
							{
								console.log(error);
								treatErrors("Error generating file system list:" + error);
								return;
							}
							ui.setTrayToolTip("Dandelion - Sincronización finalizada");
							startSync();
						});
					});
				});
			});
		});
	});
};

/*
* This function resolve possible conflicts.
 It takes an array of resources (deleted or added) and returns
 a final array based on the following questions:

 - If is not on the two lists, no conflict, do what the server wants to do.
 - The resource is in two lists (Client and server have performed changes on it)
	- Is there a pending change from the client on it? - > Probably client version is more recent, don't do anything.
	- There is no pending changes, do what the server wants to do
		and save a copied version of the file.
*/
function resolveConflicts(serverFiles, clientFiles, watchForConflicts)
{
	var finalArray = [];
	serverFiles.forEach(function(resourceMaster)
	{
		if(!isOnList(clientFiles, resourceMaster)) //No conflict
		{
			finalArray.push(resourceMaster);
		}
		else //Conflict, is on both lists
		{
			if(pendingResources[resourceMaster.name])
			{
				//Clients wants to update this file, its version will probably be more recent, do not modify it now.
				return;
			}
			//We will take server version and make a conflicted copy
			if(watchForConflicts && !resourceMaster.name.contains("_copia_en_conflicto_") && ! resourceMaster.name.startsWith(".")) //only if server wants to delete and client wants to add
			{
				conflictedResources[resourceMaster.name] = resourceMaster;
			}
			finalArray.push(resourceMaster);
		}
	});
	return finalArray;
}

function getFinalList(serverDiff, clientDiff)
{
	var finalList = {};
	var watchForConflicts = true;
	finalList.deletedDirectories = resolveConflicts(serverDiff.deletedDirectories, clientDiff.addedDirectories, watchForConflicts);
	finalList.deletedFiles = resolveConflicts(serverDiff.deletedFiles, clientDiff.addedFiles, watchForConflicts);

	watchForConflicts = false;
	finalList.addedDirectories = resolveConflicts(serverDiff.addedDirectories, clientDiff.deletedDirectories, watchForConflicts);
	finalList.addedFiles = resolveConflicts(serverDiff.addedFiles, clientDiff.deletedFiles, watchForConflicts);
	return finalList;
}

function generateLocalFileList(callback)
{
	var user =  process.env.DANDELION_USERNAME;
	var fileName = settings.RESOURCES_PATH + user + ".json";
	var resourcesArray = [];
	readdirp({ root: process.env.SERVER_FOLDER, entryType:"both", lstat:false})
	.on('data', function (entry)
	{
		var resource =
		{
			name: entry.path,
			mtime:Date.parse(entry.stat.mtime),
			size:entry.stat.size,
			resource_kind: entry.stat.isDirectory()? "directory" : "file",
			parent: entry.parentDir,
		};
		resourcesArray.push(resource);
	})
	.on('end', function()
	{
		fs.writeFile(fileName, JSON.stringify(resourcesArray), function(error)
		{
			if(error)
			{
				return callback("Error generating local file list" + error, resourcesArray);
			}
			return callback(null, resourcesArray);
		});
	});
}


//Check if an element is on a resources list,
function isOnList(list, resource)
{
	return list.some(function(resourceList)
	{
		return (resourceList.name === resource.name);
	});
}

function compareLists (masterList, slaveList, isLocal)
{
	var addedDirectories = [];
	var deletedDirectories = [];
	var addedFiles = [];
	var deletedFiles = [];
	slaveList.forEach(function(resourceSlave)
	{
		if(resourceSlave.name.startsWith("."))
		{
			return;
		}
		if (!isOnList(masterList, resourceSlave))
		{
			if(resourceSlave.resource_kind == 'directory')
			{
				deletedDirectories.push(resourceSlave);
			}
			else
			{
				deletedFiles.push(resourceSlave);
			}
		}
	});
	masterList.forEach(function(resourceMaster)
	{
		if(resourceMaster.name.startsWith("."))
		{
			return;
		}
		if (!isOnList(slaveList, resourceMaster))
		{
			if(resourceMaster && resourceMaster.resource_kind === 'directory')
			{
				addedDirectories.push(resourceMaster);
			}
			else
			{
				addedFiles.push(resourceMaster);
			}
		}
		else
		{
			var hasBeenModified = slaveList.some(function(resourceSlave)
			{
				var masterIsMoreRecent = resourceMaster.mtime > resourceSlave.mtime;
				//TODO: Mover este if arriba
				if (resourceSlave.resource_kind == 'file')  //We don't have to add directories with different timestamp
				{
					return resourceSlave.name === resourceMaster.name && masterIsMoreRecent;
				}
			});
			if (hasBeenModified && !isLocal)
			{
				addedFiles.push(resourceMaster);
			}
		}
	});
	var diffList =
	{
		deletedFiles: deletedFiles,
		deletedDirectories: deletedDirectories.sort(),
		addedFiles: addedFiles,
		addedDirectories: addedDirectories.sort(),
	};
	return diffList;
}

function applyInitialChanges(diffList, callback)
{
	var tasks = [];
	diffList.addedDirectories.forEach(function(resource)
	{
		tasks.push(function(callback){api.addDirectory(resource.name,callback);});
	});
	diffList.deletedDirectories.forEach(function(resource)
	{
		tasks.push(function(callback){api.deleteDirectory(resource.name,callback);});
	});
	diffList.addedFiles.forEach(function(resource)
	{
		tasks.push(function(callback){api.uploadFile(resource.name,callback);});
	});
	diffList.changedFiles.forEach(function(resource)
	{
		tasks.push(function(callback){api.deleteFile(resource.name,callback);});
		tasks.push(function(callback){api.uploadFile(resource.name,callback);});
	});
	diffList.deletedFiles.forEach(function(resource)
	{
		tasks.push(function(callback){api.deleteFile(resource.name,callback);});
	});
	async.series(tasks,callback);
}

function applyChangesOnLocal(diffList, callback)
{
	var tasks = [];
	conflictedResources.forEach(function(resource)
	{
		var copyConflicted = function(callback)
		{
			var origin = pathLibrary.join(process.env.SERVER_FOLDER, resource.name);
			var destination = origin + "_copia_en_conflicto_" + new Date().toISOString().substring(0,10);
			return api.copyResource(origin, destination, callback);
		};
		tasks.push(copyConflicted);
	});
	conflictedResources = {};
	diffList.addedDirectories.forEach(function(resource)
	{
		if (pendingResources[resource.name] || resource.name.startsWith("."))
		{
			return;
		}
		tasks.push(function(callback){api.createLocalDirectory(resource.name, callback);});
	});
	diffList.deletedDirectories.forEach(function(resource)
	{
		if (pendingResources[resource.name] || resource.name.contains("_copia_en_conflicto_") || resource.name.startsWith("."))
		{
			return;
		}
		tasks.push(function(callback){api.deleteLocalDirectory(resource.name, callback);});
	});
	diffList.addedFiles.forEach(function(resource)
	{
		if (pendingResources[resource.name] || resource.name.startsWith("."))
		{
			return;
		}
		tasks.push(function(callback){api.getFile(resource.name, callback);});
	});
	diffList.deletedFiles.forEach(function(resource)
	{
		if (pendingResources[resource.name] || resource.name.contains("_copia_en_conflicto_") || resource.name.startsWith("."))
		{
			return;
		}
		tasks.push(function(callback){api.deleteLocalFile(resource.name, callback);});
	});
	async.series(tasks, callback);
}

function applyChangesOnServer(callback)
{
	var tasks = [];
	pendingResources.forEach(function(resource)
	{
		if(resource.task == 'add')
		{
			tasks.push(getResourceHandler(resource.name, api.uploadFile));
		}
		else if(resource.task == 'change')
		{
			tasks.push(getResourceHandler(resource.name, api.deleteFile));
			tasks.push(getResourceHandler(resource.name, api.uploadFile));
		}
		else if(resource.task =='unlink')
		{
			tasks.push(getResourceHandler(resource.name, api.deleteFile));
		}
		else if(resource.task === 'addDir')
		{
			tasks.push(getResourceHandler(resource.name, api.addDirectory));
		}
		else if(resource.task =='unlinkDir')
		{
			tasks.push(getResourceHandler(resource.name, api.deleteDirectory));
		}
	});
	async.series(tasks, callback);
}


//We use an object so we will take only the last task if there are multiple ones
//for the same resource
function addPendingTask(path, task)
{
	pendingResources[path] = {name: path, task: task};
}
function getResourceHandler (path, resourceHandler)
{
	return function(callback)
	{
		resourceHandler(path, function(error)
		{
			if(error)
			{
				console.log("Error making a change on server: ", error, resourceHandler);
				return;
			}
			generateLocalFileList(callback);
		});
	};
}

function watchFS()
{
	if(watcher)
	{
		return;
	}
	watcher = chokidar.watch(process.env.SERVER_FOLDER,
		{
		ignored: [/[\/\\]\./, "*.dat", "*.*swp"],
		ignoreInitial: true,
		persistent: true,
		atomic:true,
		cwd:process.env.SERVER_FOLDER});
	watcher
		.on('ready', function() { console.log('Initial scan complete. Ready for changes.'); })
		.on('add', function(path)
			{
				addPendingTask(path, 'add');
			})
		.on('unlink', function(path)
			{
				addPendingTask(path, 'unlink');
			})
		.on('addDir', function(path)
			{
				addPendingTask(path, 'addDir');
			})
		.on('unlinkDir', function(path)
			{
				addPendingTask(path, 'unlinkDir');
			})
		.on('error', api.handleError);
}

function treatErrors(error)
{
	if (error  == '404')
	{
		dialog.showErrorBox("Error", "Servidor desconectado");
	}
	else if (error == '500')
	{
		dialog.showErrorBox("Error", "Error interno del servidor: " + error);
	}
	else if (error == '401' || error == '403'){
		dialog.showErrorBox("Error", "Error en la autenticación. Por favor, reinicie la aplicación");
	}
	else
	{
		dialog.showErrorBox("Error", "An error ocurred: " + error);
	}
}
