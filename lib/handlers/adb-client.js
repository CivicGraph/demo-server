'use strict';

const { sanitizePath } = require('../utils');
const { Database } = require('arangojs');

const db = new Database({
  url: `http://${process.env.ARANGO_HOST}:${process.env.ARANGO_PORT}`,
  arangoVersion: 30407
});
db.useDatabase('evstore');
db.useBearerAuth(
  process.env.BEARER_TOKEN
);
const evSvc = db.route('evstore');

function show(path, options) {
  return evSvc.post('event/show', path, options, {
      accept: 'application/json'
    }
  );
}

// noinspection JSUnusedLocalSymbols
module.exports = async (request, h) => {
  const segments = sanitizePath(request.params.path).split('/');
  const op = segments[0];

  switch (op) {
    case 'show':
      return (await show(request.payload, request.query)).body;
    default:
      return '404 Error! Page Not Found!';
  }
};