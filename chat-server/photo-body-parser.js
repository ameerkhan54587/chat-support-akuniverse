'use strict';

const express = require('express');

// Must run before the global JSON/urlencoded parsers so those parsers cannot
// consume image bytes before the /send-photo route handles them.
function parsePhotoBody(req, res, next) {
    if (req.method !== 'POST' || !/^\/api\/telegram\/users\/[^/]+\/[^/]+\/send-photo\/?$/.test(req.path)) return next();
    return express.raw({ type: () => true, limit: '8mb' })(req, res, next);
}

module.exports = { parsePhotoBody };
