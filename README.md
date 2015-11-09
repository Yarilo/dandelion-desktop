
# Dandelion desktop client

Desktop client for [Dandelion Platform](https://github.com/Yarilo/dandelion-platform). Built using [Electron Framework] (http://electron.atom.io/),  offers a GUI and a simple sync algorithm to keep user's desktop resources synched with an online remote repository.

## Installation

The desktop client is available for Mac OS X, Windows and GNU/Linux and can be used via dedicated installers (OS X and Windows) or packages (GNU/Linux)

You must have at least Node.js 0.12 and NPM installed in order to generate this installers.

````
git clone https://github.com/Yarilo/dandelion-desktop.git
cd app

# Generate a windows installer
npm run build:win

# Generate an OSX installer
npm run build:osx

# Generate a GNU/Linux Electron app
npm run pack:linux
````
The installers/packages will be generated under the `dist` directory on the root folder of the repository.

## Disclaimer

This client is part of Dandelion Platform, an online storage solution built for a Computer Engineering Master's Thesis. It is presented here as an Academical Work, and therefore is not suitable for production use.

## License
GNU - GPL v3
