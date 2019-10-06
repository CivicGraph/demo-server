'use strict';

const { escapeHtml } = require('@hapi/hoek');

exports.sanitizePath = (path) => path.split('/').map(escapeHtml).join('/');

exports.uuidv4 = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

exports.getObjClassPlural = (data) => {
  return data['obj-class']
    .substr(0, data['obj-class'].length)
    .replace(/_/g, ' ')
    .toProperCase();
};

exports.classOrder = Object.freeze({
  stars: 1,
  planets: 2,
  dwarf_planets: 3,
  moons: 4,
  asteroids: 5,
  comets: 6
});