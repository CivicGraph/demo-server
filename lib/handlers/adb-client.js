'use strict';

const { sanitizePath } = require('../utils');
const { Database } = require('arangojs');

const db = new Database({
  url: 'http://165.22.221.188:8529',
  arangoVersion: 30407
});
db.useDatabase('evstore');
db.useBearerAuth(
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjEuNTY5ODExMTE0MzE2MTc5ZSs2LCJleHAiOjE1NzI0MDMxMTQsImlzcyI6ImFyYW5nb2RiIiwicHJlZmVycmVkX3VzZXJuYW1lIjoiZXZzdG9yZSJ9.FtwywA8b4hxKqVsBh72mu_vZATutdTUSF5MGF7Obbps='
);
const evSvc = db.route('evstore');

function show(path, options) {
  return evSvc.post('event/show', path, options, {
      accept: 'application/json'
    }
  );
}

module.exports = async (request, h) => {
  const segments = sanitizePath(request.params.path).split('/');
  const op = segments[0];
  console.log(op);

  switch (op) {
    case 'show':
      return (await show(request.payload, request.query)).body;
    default:
      return '404 Error! Page Not Found!';
  }
};