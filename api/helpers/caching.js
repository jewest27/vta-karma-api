'use strict';

var geolib = require('geolib'),
  cache_impl = require('volos-cache-memory');

var profile_cache = cache_impl.create('profile-cache', {ttl: 300000});
var nearest_stop_cache = cache_impl.create('nearest-cache', {ttl: 300000});

module.exports.clearProfileCache = function(callback)
{
  console.log('Clearing profile cache...');
  profile_cache.clear(callback);
};

module.exports.profileCacheLookup = function (key, callback) {
  this.checkCache(profile_cache, key, callback);
};

module.exports.profileCacheSet = function (key, value, callback) {
  profile_cache.set(key, value, callback);
};

module.exports.stopCacheLookup = function (key, callback) {
  this.checkCache(nearest_stop_cache, key, callback);
};

module.exports.stopCacheSet = function (key, value, callback) {
  nearest_stop_cache.set(key, value, callback);
};

module.exports.checkCache = function (cache, key, callback) {

  if (!key instanceof String) {
    console.trace('Key is not instance of string!');
  }

  if (cache) {
    cache.get(key, function (err, data) {

      if (err) {
        console.log(err);
      }

      if (data)
        console.log('Cache hit on ' + cache.name + ' for key: ' + key);
      else
        console.log('Cache miss on ' + cache.name + ' for key: ' + key);

      if (callback)
        callback(err, data);
    });
  }
  else {
    console.log('Attempted to check cache which does not exist!');
    if (callback)
      callback(null, null);
  }
};

