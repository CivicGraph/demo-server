'use strict';

const { escapeHtml } = require('@hapi/hoek');

exports.sanitizePath = (path) => path.split('/').map(escapeHtml).join('/');