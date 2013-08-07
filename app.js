var http = require('http');
var express = require('express');
var socket = require('socket.io');
var less = require("less");
var lessMiddleware = require('less-middleware');
var _ = require('underscore');
var Sequelize = require("sequelize");

var app = express(express.logger());

// Fix: Cannot GET /socket.io/socket.io.js
var server = http.createServer(app);
var io = socket.listen(server);

// heroku setting
var port = process.env.PORT || 9000;

server.listen(port, function() {
	console.log("Listening on " + port);
});

// database
//var sequelize = new Sequelize('chatter_development', 'root', null, {
var sequelize = new Sequelize('chatter_development', null, null, {
        //host: '10.69.20.72',
        //port: '3306',
        dialect: 'sqlite',
        omitNull: true,
        sync: { force: true },
        syncOnAssociation: true,
        pool: { maxConnections: 5, maxIdleTime: 30},
        language: 'en'
});


var Message = sequelize.define('Messages', {
	username: { type: Sequelize.STRING, defaultValue: null },
	words: { type: Sequelize.TEXT, defaultValue: null },
    createdAt: { type: Sequelize.DATE, defaultValue: null }
});

var Connection = sequelize.define('Connections', {
	username: { type: Sequelize.STRING, defaultValue: null },
	disconnectedAt: { type: Sequelize.DATE, defaultValue: null },
    createdAt: { type: Sequelize.DATE, defaultValue: null }
});

sequelize.sync();

var status = {
	uptime : {
		run : "",
		now : ""
	},
	chatters : []
};

status.uptime.run = new Date();

app.configure(function() {
	app.use(lessMiddleware({
		src: __dirname + '/public',
		compress: true
	}));
	app.use(express.static(__dirname + '/public'));
});


// route root to index.html
app.get('/', function(req, response) {
	response.sendfile(__dirname + '/index.html');
});


app.get('/logs/:list', function(req, response) {
	var list = req.params.list;
	var data = undefined;
	switch(list) {
		case 'messages':
			Message.findAll({ order: 'createdAt DESC' }).success(function(results) {
				data = _.map(results, function(result) {
					return result.selectedValues;
				});
				response.write(JSON.stringify(data));
				response.end();
			});
			break;
		case 'connections':
			Connection.findAll({ order: 'createdAt DESC' }).success(function(results) {
				data = _.map(results, function(result) {
					return result.selectedValues;
				});
				response.write(JSON.stringify(data));
				response.end();
			});
			break;
		default:
			data = status[list] ? status[list] : [];
			status.uptime.now = new Date();
			response.write(JSON.stringify(data));
			response.end();
			break;
	}
});


io.sockets.on('connection', function(client) {
	console.log('Client connected...');

	client.on('join', function(username) {
		// set username associate to the client
		makeUnique(username, function(newUser) {
			username = newUser;
			client.set('username', newUser);
			status.chatters.push(newUser);
			client.emit('changeUsername', newUser);
			client.broadcast.emit('updateStatus', newUser + " joins the conversation.");

			// emit all the currently logged in chatters
			client.emit('updateChatters', status.chatters);
			client.broadcast.emit('updateChatters', status.chatters);

			// log connection
			Connection.build({ username: newUser }).save();
		});

		// retrieve 5 most recent messages
		Message.findAll({
			limit: 5,
			order: 'createdAt DESC'
		}).success(function(results) {
			var messages = _.map(results, function(result) {
				result.time = result.createdAt.toLocaleTimeString();
				return _.pick(result, 'username', 'words', 'time');
			});
			client.emit('restore', messages.reverse());
			// greet yourself
			client.emit('updateStatus', "Welcome " + username + ", you've joined the conversation.");
		});
	});

	client.on('disconnect', function(){
		client.get('username', function(err, username){
			status.chatters = _.without(status.chatters, username);
			Connection.findAll({
				where: {username: username},
				order: 'id DESC',
				limit: 1
			}).success(function(results) {
				if (results.length > 0) {
					results[0].disconnectedAt = new Date();
					results[0].save();
				}
			});
			client.broadcast.emit('updateChatters', status.chatters);
			client.broadcast.emit('updateStatus', username + " left the conversation.");
		});
	});

	// broadcast message to all other clients
	client.on('send', function(msg) {
		client.get('username', function(err, username) {
			var message = {
				time: (new Date()).toLocaleTimeString(),
				username: (username != null) ? username : msg.username,
				words: msg.words
			};

			// store message
			Message.build({
				username: message.username,
				words: message.words
			}).save();

			// send message with server time back to self
			client.emit('send', message);
			// broadcast message
			client.broadcast.emit('send', message);
		});

		// Update missing chatters
		if (status.chatters.indexOf(msg.username) == -1) {
			status.chatters.push(msg.username);
			_.compact(status.chatters);
			client.emit('updateChatters', status.chatters);
			client.broadcast.emit('updateChatters', status.chatters);
		}
	});
});


function makeUnique(name, callback) {
	if ( status.chatters.indexOf(name) !== -1 ) {
		var parts = name.split(" ");
		var num = parts[1] ? parseInt(parts[1]) + 1 : 2;
		name = parts[0] + " " + num;
		makeUnique(name, callback);
	} else {
		callback(name);
	}
}
