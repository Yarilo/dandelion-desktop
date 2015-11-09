'use strict';

require('prototypes');
var app = require('app');
var BrowserWindow = require('browser-window');
var Menu = require('menu');
var Tray = require('tray');
var shell = require('shell');
var ipc = require('ipc');
var appIcon = null;
var fs = require('fs');
var lineReader = require('line-reader');
var client = require('./client.js');
var dialog = require('dialog');
var pathLibrary = require('path');
var settings = require('./settings.js');

require('crash-reporter').start();
var mainWindow = null;
var appIcon = null;
var WINDOW_SIZE =
{
	width: 620,
	height: 480,
};
var ENV_FILE = settings.ENV_FILE_PATH;
var LOGIN_URL = 'file://' + __dirname + '/login.html';

app.on('ready', function() {

	if(!mainWindow)
	{
		mainWindow = new BrowserWindow(WINDOW_SIZE);
		if (userIsAuthenticated())
		{
			startClient(function(error)
			{
				if (error)
				{
					dialog.showErrorBox("Error","Error iniciando el cliente: ", error);
					return ;
				}
			});
		}
		else
		{
			mainWindow.loadUrl(LOGIN_URL);
			mainWindow.on('closed', function() {mainWindow = null;});
		}
	}
});

app.on('window-all-closed', function() {
	if(!appIcon)
	{
		app.quit();
	}
	else
	{
		console.log("Exit preference window, Dandelion will continue running on tray doc");
	}
});

function userIsAuthenticated ()
{
	return process.env.TOKEN || (process.env.DANDELION_USERNAME && process.env.PASSWORD);
}

function startClient (callback)
{
	client.login(function(error)
	{
		if (error)
		{
			var options =
			{
				type: 'warning',
				buttons: ["Aceptar"],
				title: "Credenciales incorrectos",
				message:"Usuario o contraseña incorrectos, por favor, inténtelo nuevamente.",
				icon: __dirname + '/assets/logo.png',
			};
			dialog.showMessageBox(mainWindow, options);
			if (mainWindow.webContents.getUrl() !== LOGIN_URL)
			{
				mainWindow.loadUrl(LOGIN_URL);
			}
			return callback(error);
		}
		client.start(function(error)
		{
			if(error)
			{
				return callback(error);
			}
			createTray ();
			mainWindow.loadUrl('file://' + __dirname + '/index.html');
			return callback(null);
		});
	});
}

function logOut()
{
	client.stop();
	process.env.DANDELION_USERNAME = "";
	process.env.PASSWORD ="";
	process.env.TOKEN ="";
	var newContents = "";
	lineReader.eachLine(ENV_FILE, function(line)
	{
		var field = line.substringUpTo('=').trim();
		if(field =='USERNAME' || field == 'PASSWORD')
		{
		  line = field + "=";
		}
		newContents += line + "\n";
	}).then(function ()
	{
		fs.writeFile(ENV_FILE, newContents, function(error)
		{
			if (error)
			{
				dialog.showErrorBox("Error","Error escribiendo archivo de configuración al salir: ", error);
			}
		});
	});
	if(!mainWindow)
	{
		mainWindow = new BrowserWindow(WINDOW_SIZE);
	}
	mainWindow.loadUrl('file://' + __dirname + '/login.html');
	appIcon.destroy();
	appIcon = null;
}
function createTray ()
{
	if(appIcon)
	{
		return;
	}
	appIcon = new Tray(__dirname + '/assets/tray_logo.png');
	var contextMenu = Menu.buildFromTemplate([
	  { label: 'Abrir carpeta Dandelion', click: function(){shell.showItemInFolder(process.env.SERVER_FOLDER);}},
	  { label: 'Ir al sitio web del servidor', click: function(){shell.openExternal(process.env.SERVER_ADDRESS);}},
	  { label: 'Preferencias', click: openPreferences },
	  { type:'separator'},
	  { label: 'Pausar/Reanudar sincronización', click: pauseResumeSync},
	  { label: 'Cerrar Sesión', click: logOut},
	  { label: 'Cerrar Dandelion', click: exitApp},
	]);
	appIcon.setToolTip('Dandelion - Iniciado');
	appIcon.setContextMenu(contextMenu);
}

exports.setTrayToolTip = function(message)
{
	if(appIcon)
	{
		appIcon.setToolTip(message);
	}
};

function openPreferences()
{
  if (!mainWindow)
  {
	mainWindow = new BrowserWindow(WINDOW_SIZE);
	mainWindow.loadUrl('file://' + __dirname + '/index.html');
	mainWindow.on('closed', function() {
		mainWindow = null;
	});
  }
}
function exitApp()
{
	app.quit();
}

ipc.on('login-form-complete', function(event, values)
{
	updateSettings(values);
	fs.mkdir(settings.LISTS_PATH, function(error)
	{
		if (error)
		{
			dialog.showErrorBox("Error", "Error iniciando el cliente: " + error);
		}
		startClient(function(error)
		{
			if (error)
			{
				dialog.showErrorBox("Error", "Error iniciando el cliente: " + error);
				for(var field in values) //Reset env variables
				{
				  process.env[field] = "";
				}
				return;
			}
			storeSettingsFirstTime(values, function (error)
			{
				if (error)
				{
					dialog.showErrorBox("Error", "Error guarando las preferencias: " + error);
					return;
				}
			});
		});
	});
});
ipc.on('config-form-complete', function(event, values)
{
	//Update env variables and then write them to disk
	updateSettings(values);
	var options =
	{
		type: 'info',
		buttons: ["Aceptar"],
		title: "Preferencias actualizadas",
		message:"Preferencias actualizadas correctamente.",
		icon: __dirname + '/assets/logo.png',
	};
	dialog.showMessageBox(mainWindow, options);
	storeSettings(values, function(error)
	{
		if (error)
		{
			dialog.showErrorBox("Error", "Error guarando las preferencias: " + error);
			return;
		}
	});
});

function updateSettings(values)
{
	for(var field in values)
	{
		if(!values[field])
		{
			continue;
		}
		if(field == 'SERVER_FOLDER' && !values[field].endsWith(pathLibrary.sep))
		{
			values[field] = values[field] + pathLibrary.sep;
		}
		process.env[field] = values[field];
	}
}

function storeSettingsFirstTime(values, callback)
{
	var newContents = "";
	for(var field in values)
	{
		var line = field + "=" + values[field];
		newContents += line + "\n";
	}
	newContents += "SERVER_PORT=80" + "\n";
	newContents += "SYNC_FREQ=20" + "\n";
	newContents += "HTTPS=false" + "\n";
	fs.writeFile(ENV_FILE, newContents, function(error)
	{
		if (error)
		{
			console.log("Error writing configuration file", error);
			return callback(error);
		}
		return callback(null);
	});

}
//Store env settings file with new value
function storeSettings(values, callback)
{
	var newContents = "";
	lineReader.eachLine(ENV_FILE, function(line)
	{
		var field = line.substringUpTo('=').trim();
		if(values.hasOwnProperty(field) )
		{
			if (values[field] || field == 'HTTPS')
			{
				line = field + "=" + values[field];
			}
		}
		newContents += line + "\n";
	}).then(function ()
	{
		fs.writeFile(ENV_FILE, newContents, function(error)
		{
			if (error)
			{
				console.log("Error writing configuration file", error);
				return callback(error);
			}
			return callback(null);
		});
	});
}

function pauseResumeSync()
{
	if(!process.env.STOPPED) //This code makes Jesus baby cries.
	{
		client.stop();
		appIcon.setToolTip('Dandelion - Sincronización pausada');
		process.env.STOPPED = true;
	}
	else
	{
		appIcon.setToolTip('Dandelion - Reanudando sincronización');
		client.start(function(error)
		{
			appIcon.setToolTip('Dandelion - Iniciado');
			if(error)
			{
				dialog.showErrorBox("Error","No se pudo reanudar la sincronización: ", error);
				return;
			}
			process.env.STOPPED = false;
		});

	}
}
