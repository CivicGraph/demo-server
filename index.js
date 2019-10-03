'use strict';

const Hapi = require('@hapi/hapi');
const Path = require('path');
const { sanitizePath } = require('./lib/utils');
require('dotenv').config();
const adbClient = require('./lib/handlers/adb-client');

const init = async () => {
  let port = process.env.PORT;
  if (port === null || port === "") {
    port = 8000;
  }

  const server = Hapi.server({
    port,
    host: 'localhost',
    routes: {
      files: {
        relativeTo: Path.join(__dirname, 'public')
      }
    }
  });

  await server.register(require('inert'));

  server.route({
    method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    path: '/api/{path*}',
    handler: adbClient
  });

  server.route({
    method: 'GET',
    path: '/',
    handler: (request, h) => h.file('index.html')
  });

  server.route({
    method: 'GET',
    path: '/{path*}',
    handler: (request, h) => h.file(sanitizePath(request.params.path))
  });

  await server.start();
  console.log('Server running on %s', server.info.uri);
};

process.on('unhandledRejection', (err) => {

  console.error(err);
  process.exit(1);
});

// noinspection JSIgnoredPromiseFromCall
init();