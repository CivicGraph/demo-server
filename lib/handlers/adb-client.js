'use strict';

const { sanitizePath } = require('../utils');
const { Database, aql } = require('arangojs');

const db = new Database({
  url: `http://${process.env.ARANGO_HOST}:${process.env.ARANGO_PORT}`,
  arangoVersion: 30407
});
db.useDatabase('evstore');
db.useBearerAuth(
  process.env.BEARER_TOKEN
);
const evSvc = db.route('evstore');

async function load() {
  const response = await evSvc.get('event/show', {
      path: '/g/evstore_test_ss_lineage',
      groupBy: 'type'
    }, {
      accept: 'application/json'
    }
  );

  return response.body;
}

async function show(sessionID, nids, options = {}) {
  let path;
  if (nids) {
    nids = nids.reduce((acc, nid) => {
      const parts = nid.split(/[\/_]/);
      const type = parts[2];
      const key = parts[3];
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(key);

      return acc;
    }, {});

    const pathSegments = [`/n/demo_${sessionID}_{`];
    const keyFragments = [];
    for (const type in nids) {
      // noinspection JSUnfilteredForInLoop
      keyFragments.push(`${type}/{${nids[type].join(',')}}`);
    }
    pathSegments.push(keyFragments.join(','), '}');

    path = pathSegments.join('');
  }
  else {
    path = `/c/demo_${sessionID}_{vertex,edge}`;
  }

  const response = await evSvc.post('event/show', { path }, Object.assign(options, { groupBy: 'type' }),
    { accept: 'application/json' });

  return response.body;
}

function getCollectionName(sessionID, type) {
  return `demo_${sessionID}_${type}`;
}

function getCollection(sessionID, type) {
  const collName = getCollectionName(sessionID, type);

  switch (type) {
    case 'vertex':
      return db.collection(collName);
    case 'edge':
      return db.edgeCollection(collName);
    default:
      return Promise.reject('Unsupported collection type.');
  }
}

async function initSession(sessionID) {
  const vertexColl = await getCollection(sessionID, 'vertex');
  const edgeColl = await getCollection(sessionID, 'edge');

  await vertexColl.create();
  await edgeColl.create();
  await vertexColl.get();
  await edgeColl.get();

  const query = aql`
    let sun = (
      for s in evstore_test_stars
      return s
    )[0]
    for v, e, p in 0..1
    outbound sun
    graph 'evstore_test_ss_lineage'
      filter parse_identifier(v).collection in ['evstore_test_planets', 'evstore_test_stars']
    return {v, e}
  `;

  const cursor = await db.query(query);
  const vertices = [], edges = [];
  let sun;
  while (cursor.hasNext()) {
    const row = await cursor.next();
    const v = row.v;
    v['obj-class'] = v._id.match(/evstore_test_(.*)\/.*/)[1];
    v._key += `_${v['obj-class']}`;

    delete v._id;
    delete v._rev;
    delete v._source;

    vertices.push(v);
    if (vertices.length === 1) {
      sun = v;
    }

    const e = row.e;
    if (e) {
      e._from = `${vertexColl.name}/${sun._key}`;
      e._to = `${vertexColl.name}/${v._key}`;

      delete e._rev;

      edges.push(e);
    }
  }

  evSvc.post(`document/${vertexColl.name}`, vertices, { silent: true }, { accept: 'application/json' });
  evSvc.post(`document/${edgeColl.name}`, edges, { silent: true }, { accept: 'application/json' });

  return true;
}

module.exports = async (request, h) => {
  const segments = sanitizePath(request.params.path).split('/');
  const op = segments[0];

  const sessionID = request.headers['x-session-id'];
  if (!sessionID) {
    return h.response('Error - Missing x-session-id Header.').code(400);
  }

  try {
    switch (op) {
      case 'show':
        return show(sessionID, request.payload, request.query);

      case 'load':
        return load();

      case 'init':
        return initSession(sessionID);

      default:
        return h.response('404 Error - Endpoint Not Found.').code(404);
    }
  }
  catch (e) {
    console.log(e);
    h.response('500 - Internal Server Error').code(500);
  }
};