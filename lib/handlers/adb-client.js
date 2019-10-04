'use strict';

const { sanitizePath, uuidv4 } = require('../utils');
const { Database, aql } = require('arangojs');
const rp = require('request-promise-native');

const db = new Database({
  url: `http://${process.env.ARANGO_HOST}:${process.env.ARANGO_PORT}`,
  arangoVersion: 30407
});
db.useDatabase('evstore');
db.useBearerAuth(
  process.env.BEARER_TOKEN
);
const evSvc = db.route('evstore');

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

  try {
    const response = await evSvc.post('event/show', { path }, Object.assign(options, { groupBy: 'type' }),
      { accept: 'application/json' });
    const data = response.body;
    if (!data.length) {
      await initSession(sessionID);
    }

    const vertices = data.find(group => group.type === 'vertex').nodes;
    const edges = data.find(group => group.type === 'edge').nodes;

    for (const v of vertices) {
      v.id = v._id;

      delete v._id;
      delete v._key;
      delete v._rev;
    }

    for (let e of edges) {
      e.id = e._id;
      e.source = e._from;
      e.target = e._to;

      delete e._id;
      delete e._key;
      delete e._rev;
      delete e._from;
      delete e._to;
    }

    return data;
  }
  catch (e) {
    console.error(e);

    throw e;
  }
}

function getCollectionName(sessionID, type) {
  return `demo_${sessionID}_${type}`;
}

async function getCollection(sessionID, type) {
  let coll;
  const collName = getCollectionName(sessionID, type);

  switch (type) {
    case 'vertex':
      coll = db.collection(collName);

      break;
    case 'edge':
      coll = db.edgeCollection(collName);

      break;
    default:
      return Promise.reject('Unsupported collection type.');
  }

  if (!(await coll.exists())) {
    await coll.create();
  }
  await coll.get();

  return coll;
}

function getObjectClass(v) {
  return v._id.match(/evstore_test_(.*)\/.*/)[1];
}

async function initSession(sessionID) {
  const vertexColl = await getCollection(sessionID, 'vertex');
  const edgeColl = await getCollection(sessionID, 'edge');

  try {
    const query = aql`
    let sun = (
      for s in evstore_test_stars
      return s
    )[0]
    for v, e in 0..1
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
      v['obj-class'] = getObjectClass(v);
      v._key = uuidv4();
      v._rawId = v._id;

      delete v._id;
      delete v._source;
      delete v._rev;
      delete v._ref;

      vertices.push(v);
      if (vertices.length === 1) {
        sun = v;
      }

      const e = row.e;
      if (e) {
        // noinspection JSPrimitiveTypeWrapperUsage
        e._from = `${vertexColl.name}/${sun._key}`;
        // noinspection JSPrimitiveTypeWrapperUsage
        e._to = `${vertexColl.name}/${v._key}`;

        delete e._id;
        delete e._rev;

        edges.push(e);
      }
    }

    await evSvc.post(`document/${vertexColl.name}`, vertices, {}, { accept: 'application/json' });
    await evSvc.post(`document/${edgeColl.name}`, edges, {}, { accept: 'application/json' });

    return true;
  }
  catch (e) {
    console.error(e);

    throw e;
  }
}

async function addChildren(sessionID, parentID, children) {
  const vertexColl = await getCollection(sessionID, 'vertex');
  const edgeColl = await getCollection(sessionID, 'edge');
  const edges = [];

  for (let c of children) {
    edges.push({
      _from: parentID,
      _to: `${vertexColl.name}/${c._key}`
    });
  }

  try {
    await evSvc.post(`document/${vertexColl.name}`, children, {}, { accept: 'application/json' });
    await evSvc.post(`document/${edgeColl.name}`, edges, {}, { accept: 'application/json' });

    return true;
  }
  catch (e) {
    console.error(e);

    throw e;
  }

}

async function edit(sessionID, node) {
  const vertexColl = await getCollection(sessionID, 'vertex');

  try {
    await evSvc.put(`document/${vertexColl.name}`, node, { ignoreRevs: true }, { accept: 'application/json' });

    return true;
  }
  catch (e) {
    console.error(e);

    throw e;
  }

}

async function listChildren(sessionID, _rawId) {
  const query = aql`
    for v in 1
    outbound ${_rawId}
    graph 'evstore_test_ss_lineage'
    return v
  `;

  const cursor = await db.query(query);
  const vertices = [];
  while (cursor.hasNext()) {
    const v = await cursor.next();
    v['obj-class'] = getObjectClass(v);
    v._key = uuidv4();
    v._rawId = v._id;

    delete v._id;
    delete v._source;
    delete v._rev;
    delete v._ref;

    vertices.push(v);
  }

  return vertices;
}

async function remove(sessionID, nid) {
  const vertexCollName = getCollectionName(sessionID, 'vertex');
  const edgeCollName = getCollectionName(sessionID, 'edge');

  const queryParts = [
    aql`
      for v, e in 0..10
      outbound ${nid}
    `,
    aql.literal(edgeCollName),
    aql`return {v, e}`
  ];

  const query = aql.join(queryParts, '\n');

  const cursor = await db.query(query);
  const vertices = [], edges = [];

  while (cursor.hasNext()) {
    const row = await cursor.next();

    vertices.push(row.v);

    if (row.e) {
      edges.push(row.e);
    }
  }

  try {
    const inEdge = await (await getCollection(sessionID, 'edge')).firstExample({ _to: nid });
    edges.push(inEdge);
  }
  catch (e) {
  }

  const options = {
    method: 'DELETE',
    qs: {
      silent: true
    },
    json: true,
    auth: {
      bearer: process.env.BEARER_TOKEN
    }
  };

  await rp(Object.assign({
    uri: `http://${process.env.ARANGO_HOST}:${process.env.ARANGO_PORT}/_db/evstore/evstore/document/${vertexCollName}`,
    body: vertices
  }, options));

  await rp(Object.assign({
    uri: `http://${process.env.ARANGO_HOST}:${process.env.ARANGO_PORT}/_db/evstore/evstore/document/${edgeCollName}`,
    body: edges
  }, options));

  return true;
}

module.exports = async (request, h) => {
  const segments = sanitizePath(request.params.path).split('/');
  const op = segments[0];

  let sessionID = request.headers['x-session-id'];
  if (!sessionID) {
    return h.response('Error - Missing x-session-id Header.').code(400);
  }
  sessionID = sessionID.replace(/-/g, '_');

  try {
    switch (op) {
      case 'show':
        return show(sessionID, request.payload, request.query);

      case 'list':
        return listChildren(sessionID, request.query._rawId);

      case 'remove':
        return remove(sessionID, request.query.nid);

      case 'add':
        return addChildren(sessionID, request.query.parentID, request.payload);

      case 'edit':
        return edit(sessionID, request.payload);

      case 'init':
        return initSession(sessionID);

      default:
        return h.response('404 Error - Endpoint Not Found.').code(404);
    }
  }
  catch (e) {
    console.error(e);
    h.response('500 - Internal Server Error').code(500);
  }
};
