'use strict';

var util = require('util'),
  async = require('async'),
  usergrid = require('usergrid'),
  geolib = require('geolib'),
  Q = require('q'),
  cache_memory = require('volos-cache-memory'),
  request = require('request');

var BAAS_URL = "https://api.usergrid.com";
var BAAS_ORG_NAME = "vta";
var BAAS_APP_NAME = "sandbox";

var APP_URL = BAAS_URL + '/' + BAAS_ORG_NAME + '/' + BAAS_APP_NAME;

var metersInMile = 1609.34;

var busEmissionsPerMile = 0.107;
var autoEmissionsPerGallon = 8.91;

var averageFuelEfficiencyMpg = 23.6;
var smallCarEfficiencyMpg = 40;
var mediumCarEfficiencyMpg = 30;
var truckEfficiencyMpg = 17;

var profile_cache = cache_memory.create('profile-cache');
var nearest_stop_cache = cache_memory.create('nearest-cache');

var options = {
  URI: BAAS_URL,
  orgName: BAAS_ORG_NAME,
  appName: BAAS_APP_NAME,
  authType: usergrid.AUTH_APP_USER
};

var client = new usergrid.client(options);

function calculateDistanceMeters(trip) {
  console.log('calculateDistanceMeters');

  var lastWaypoint = trip['tripBegin'];
  var totalDistanceMeters = 0;

  var d_meters = 0.0;

  trip.waypoints.forEach(function (thisWaypoint) {
    var d_meters = geolib.getDistance(
      {latitude: lastWaypoint['latitude'], longitude: lastWaypoint['longitude']},
      {latitude: thisWaypoint ['latitude'], longitude: thisWaypoint ['longitude']},
      1
    );

    lastWaypoint = thisWaypoint;
    totalDistanceMeters += d_meters;
  });

  d_meters = geolib.getDistance(
    {latitude: lastWaypoint['latitude'], longitude: lastWaypoint['longitude']},
    {latitude: trip['tripEnd']['latitude'], longitude: trip['tripEnd']['longitude']},
    1
  );

  totalDistanceMeters += d_meters;

  console.log('distance: ' + totalDistanceMeters);

  return totalDistanceMeters;
}

function incrementCounters(userId, ride_entity, callback) {
  var rideSummary = ride_entity.summary;

  console.log('== Incrementing counters... ');

  async.parallel([
      function (async_callback) {
        incrementSavings(userId, rideSummary['savings'],
          function (err, data) {
            if (err) {
              console.log(err);
              async_callback({
                message: "Error looking incrementing savings counter",
                usergridError: err
              });
            }
            else {
              console.log('Incremented Savings...');
              async_callback(null, data);
            }
          });
      },
      function (async_callback) {
        incrementDistance(userId, rideSummary,
          function (err, data) {
            if (err) {
              console.log(err);
              async_callback({
                message: "Error looking incrementing savings counter",
                usergridError: err
              });
            }
            else {
              console.log('Incremented Distance...');
              async_callback(null, data);
            }
          });
      }
    ],
    function (err, results) {
      if (err) {
        if (callback)
          callback(err);
      }
      else {
        if (callback)
          callback(null, results);
      }
    });

}

function incrementSavings(userId, savings, callback) {
  console.log('Incrementing Savings...');

  var d = new Date();

  var counterName = 'savings.co2.' + userId.username + '.' + d.getFullYear() + '.' + (d.getMonth() + 1);
  var counterData = {
    'timestamp': 0,
    'counters': {}
  };

  counterData['counters'][counterName] = Math.round(savings['versusAverage'], 1);

  console.log('Counter Name: ' + counterName);

  request({
      url: APP_URL + '/events',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(counterData)
    },
    function (error, response, body) {
      if (error) {
        callback(error)
      } else if (response.statusCode != 200) {
        callback("Response status code " + response.statusCode + ": " + body)
      }
      else {
        var sendMe = JSON.parse(body);
        callback(null, sendMe)
      }
    });
}

function incrementDistance(userId, tripSummary, callback) {
  console.log('Incrementing distance...');

  var d = new Date();

  var counterName = 'distance.' + userId.username + '.' + d.getFullYear() + '.' + (d.getMonth() + 1);
  var counterData = {
    'timestamp': 0,
    'counters': {}
  };

  counterData['counters'][counterName] = Math.round(tripSummary.distanceTraveled.miles, 1);

  console.log('Counter Name: ' + counterName);

  request({
      url: APP_URL + '/events',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(counterData)
    },
    function (error, response, body) {
      if (error) {
        callback(error)
      } else if (response.statusCode != 200) {
        callback("Response status code " + response.statusCode + ": " + body)
      }
      else {
        var sendMe = JSON.parse(body);
        callback(null, sendMe)
      }
    });
}

function postTrip(token, ride_data, callback) {
  if (ride_data)
    console.log('posting ride data...');

  request({
      url: APP_URL + '/rides',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify(ride_data)
    },
    function (err, response, body) {
      if (err) {
        console.log('Error making trip post request: ' + err);

        if (callback)
          callback(err)
      } else if (response.statusCode != 200) {
        console.log("Response status code " + response.statusCode + ": " + body);

        if (callback)
          callback("Response status code " + response.statusCode + ": " + body)
      }
      else {
        console.log('Trip posted to API');
        var sendMe = JSON.parse(body);
        if (callback) callback(null, sendMe.entities[0])
      }
    });
}

function getNearestStop(token, waypoint, callback) {
  var deferred;

  if (!callback) {
    deferred = Q.defer()
  }

  var cache = nearest_stop_cache;
  var key = JSON.stringify(waypoint);

  if (!key) {
    console.trace("-- Key must be defined!!!!!!");

    if (callback)
      callback("Key must be defined");
    if (deferred)
      deferred.reject("Key must be defined");
  }
  else {
    checkCache(cache, key, function (err, data) {
        if (err) {
          console.log('Error getting nearest: ' + err);
          if (callback)
            callback(err);
          if (deferred) {
            console.log('reject deferred');
            deferred.reject(err);
          }
        }
        else if (data) {
          if (callback)
            callback(null, JSON.parse(data));
          if (deferred) {
            deferred.resolve(data);
          }
        }
        else {
          request({
              url: APP_URL + '/stops',
              headers: {
                'Authorization': 'Bearer ' + token
              },
              qs: {
                ql: 'select * where location within 10 of ' + waypoint['latitude'] + ', ' + waypoint['longitude']
              }
            },
            function (err, response, body) {
              if (err) {
                console.log('Error getting nearby: ' + err);

                if (deferred) {
                  console.log('reject deferred');
                  deferred.reject(err);
                }
                if (callback)
                  callback(err);
              }
              else {

                if (response.statusCode == 200) {

                  var response_json = JSON.parse(body);

                  if (response_json['entities'] && response_json['entities'].length > 0) {
                    var responseEntity = response_json['entities'][0];

                    //console.log('using stop: ' + responseEntity.name);

                    if (deferred)
                      deferred.resolve(responseEntity);
                    if (callback)
                      callback(null, responseEntity);

                    if (cache)
                      cache.set(key, JSON.stringify(responseEntity));
                  }
                  else {
                    // todo: better solution
                    console.log('using default stop!');
                    client.getEntity({type: "stop", name: "default"},
                      function (err, entity) {
                        if (err) {
                          console.log(err);

                          if (deferred)
                            deferred.reject(err);
                          else if (callback)
                            callback(err);
                        }
                        else {
                          if (cache)
                            cache.set(key, JSON.stringify(entity));

                          if (deferred)
                            deferred.resolve(entity);
                          else if (callback)
                            callback(null, entity);
                        }
                      })
                  }
                }
                else {
                  console.log('BAD RESPONSE! code=' + response.statusCode + ' body: ' + body);
                }
              }
            });
        }
      }
    );
  }

  if (deferred)
    return deferred.promise;
}

function connectEntities(token, source_entity, target_entity, verb, callback) {
  console.log(APP_URL + '/' + source_entity['type'] + '/' + source_entity.uuid + '/' + verb + '/' + target_entity.uuid);

  request({
      url: APP_URL + '/' + source_entity['type'] + '/' + source_entity.uuid + '/' + verb + '/' + target_entity.uuid,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      }
    },
    function (error, response, body) {
      if (error) {
        callback(build_error('Error connecting entities', error))
      } else if (response.statusCode != 200) {
        callback(build_error('Error connecting entities', body, response.statusCode));
      }
      else {
        callback(null, JSON.parse(body))
      }
    });
}

function connectStartStopLocations(token, ride_entity, fx_callback) {
  console.log('connectStartStopLocations');

  async.parallel({
      beginsAt: function (callback) {
        async.waterfall([
            function (w_callback) {
              getNearestStop(token, ride_entity.tripBegin, w_callback);
            },
            function (nearestBegin, w_callback) {
              connectEntities(token, ride_entity, nearestBegin, 'beginsAt', w_callback)
            }
          ],
          callback);
      },
      endsAt: function (callback) {
        async.waterfall([
          function (w_callback) {
            getNearestStop(token, ride_entity.tripEnd, w_callback);
          },
          function (nearestBegin, w_callback) {
            connectEntities(token, ride_entity, nearestBegin, 'endsAt', w_callback)
          }
        ], callback);
      }
    },    fx_callback);
}

function getCounterValue(token, counterName, callback) {

  request({
      method: 'GET',
      url: APP_URL + '/counters?counter=' + counterName,
      headers: {
        'Authorization': 'Bearer ' + token
      }
    },
    function (err, response, body) {
      if (err) {
        callback(err);
      }
      else {
        if (response.statusCode != 200) {
          callback(build_error('Unable to get counter value: ' + counterName, body, response.statusCode));
        }
        else {
          var response_json = JSON.parse(body);
          var found = false;

          response_json.counters.forEach(function (counter) {
            if (counter.name == counterName) {
              found = true;

              if (counter.values.length > 0) {
                console.log('counterName: ' + counterName + ' value: ' + counter.values[0].value);
                callback(null, counter.values[0].value);
              }
              else {
                console.log('counterName: ' + counterName + ' value: 0');
                callback(null, 0)
              }
            }
          });

          if (!found)
            callback(build_error('Unable to get counter value: ' + counterName));
        }
      }
    });
}

function getSavings(token, profileData, callback) {
  console.log('getSavings');

  var d = new Date();

  async.parallel({
    all: function (callback) {
      getCounterValue(token, 'savings.co2.' + profileData.username, callback)
    },
    year: function (callback) {
      getCounterValue(token, 'savings.co2.' + profileData.username + '.' + d.getFullYear(), callback);
    },
    month: function (callback) {
      getCounterValue(token, 'savings.co2.' + profileData.username + '.' + d.getFullYear() + '.' + (d.getMonth() + 1), callback)
    }
  }, callback);
}

function checkCache(cache, key, callback) {

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
}

function getMeUser(token, callback) {
  console.log('getMeUser');

  var cache = profile_cache;

  checkCache(cache, token, function (err, data) {
    if (err) {
      if (callback)
        callback(err);
    }
    else if (data) {
      if (callback)
        callback(null, JSON.parse(data));
    }
    else {
      request({
          method: 'GET',
          url: APP_URL + '/users/me',
          headers: {
            'Authorization': 'Bearer ' + token
          }
        },
        function (err, response, body) {
          if (err) {
            console.log(err);
            if (callback)
              callback(err);
          }
          else {
            if (response.statusCode != 200) {
              if (callback)
                callback(build_error('Error getting /users/me', body, response.statusCode));
            }
            else {
              console.log('Retrieved user: ' + body);
              var user_response = JSON.parse(body);

              if (callback)
                callback(null, user_response.entities[0]);

              if (cache)
                cache.set(token, body)
            }
          }
        });
    }
  });
}

module.exports.getRideById = function (req, res) {
  request({
      method: 'GET',
      url: APP_URL + '/rides/' + req.swagger.params.tripId.value,
      headers: {
        'Authorization': 'Bearer ' + req.swagger.params.access_token.value
      }
    },
    function (err, response, body) {
      if (err) {
        console.log(err);
        res.status(500).json(build_error("Error looking up stops", err));
      }
      else {
        if (response.statusCode != 200) {
          res.json(body);
        } else {
          var entities = JSON.parse(body).entities;
          res.json(entities);
        }
      }
    });
};

module.exports.getToken = function (req, res) {
  console.log('getting token..');

  request({
      method: 'GET',
      url: APP_URL + '/auth/facebook',
      qs: {
        'fb_access_token': req.swagger.params.fb_access_token.value
      },
      headers: {
        'Content-Type': 'application/json'
      }
    },
    function (err, response, body) {
      if (err) {
        console.log(err);
        res.status(500).json(err);
      }
      else {
        if (response.statusCode != 200) {
          res.status(response.statusCode).json(body);
        }
        else {
          var user_response = JSON.parse(body);
          res.json(user_response);
        }
      }
    });
};

module.exports.getProfile = function (req, res) {

  getMeUser(req.swagger.params.access_token.value,
    function (err, profile_data) {
      if (err) {
        res.status(500).json(build_error("Error looking up /users/me", err));
      }
      else {
        getSavings(req.swagger.params.access_token.value, profile_data,
          function (err, savings_data) {
            profile_data['savings'] = savings_data;

            res.json(profile_data);
          });
      }
    }
  );
};

function getCo2Reference(totalDistanceMiles, averageFuelEfficiencyMpg, autoEmissionsPerGallon) {
  var gallonsRequired = totalDistanceMiles / averageFuelEfficiencyMpg;
  return gallonsRequired * autoEmissionsPerGallon;
}

module.exports.getStopById = function (req, res) {
  request({
      method: 'GET',
      url: APP_URL + '/stops/' + req.swagger.params.stopId.value,
      headers: {
        'Authorization': 'Bearer ' + req.swagger.params.access_token.value
      }
    },
    function (err, response, body) {
      if (err) {
        console.log(err);
        res.status(500).json(build_error("Error looking up stops", err));
      }
      else {
        var entities = JSON.parse(body).entities;
        res.json(entities);

        if (cache)
          cache.set(key, JSON.stringify(entities));
      }
    });
};

module.exports.getNearestStops = function (req, res) {
  request({
      method: 'GET',
      url: APP_URL + '/stops',
      qs: {
        ql: 'select * where location within ' + req.swagger.params.radius.value + ' of ' + req.swagger.params.latitude.value + ',' + req.swagger.params.longitude.value
      },
      headers: {
        'Authorization': 'Bearer ' + req.swagger.params.access_token.value
      }
    },
    function (err, response, body) {
      if (err) {
        console.log(err);
        res.status(500).json(build_error("Error looking up stops", err));
      }
      else {
        res.json(JSON.parse(body).entities);
      }
    });
};

module.exports.getRides = function (req, res) {

  request({
      method: 'GET',
      url: APP_URL + '/users/me/rides',
      headers: {
        'Authorization': 'Bearer ' + req.swagger.params.access_token.value
      }
    },
    function (err, response, body) {

      if (err) {
        res.stattus(500).json(build_error("Error looking up /users/me/trips", err));
      } else if (response.statusCode != 200) {
        res.status(500).json("Response status code " + response.statusCode + ": " + body);
      }

      else {
        var entities = JSON.parse(body).entities;
        res.json({rides: entities});

      }
    });
};

function build_error(message, err, statusCode) {
  var response = {};

  if (message)
    response['message'] = message;

  if (statusCode)
    response['statusCode'] = statusCode;

  if (err)
    response['targetError'] = err;

  return response
}

module.exports.postRide = function (req, res) {
  var ride_data = req.swagger.params.ride.value;
  var token = req.swagger.params.access_token.value;

  var totalDistanceMeters = calculateDistanceMeters(ride_data);

  var totalDistanceMiles = totalDistanceMeters / metersInMile;
  var co2EmittedInKg = totalDistanceMiles * busEmissionsPerMile;

  var rideSummary = {
    distanceTraveled: {
      'meters': totalDistanceMeters,
      'miles': totalDistanceMeters / metersInMile
    },
    reference: {
      busEmissionsPerMile: busEmissionsPerMile,
      autoEmissionsPerGallon: autoEmissionsPerGallon,
      averageFuelEfficiencyMpg: averageFuelEfficiencyMpg,
      smallCarEfficiencyMpg: smallCarEfficiencyMpg,
      mediumCarEfficiencyMpg: mediumCarEfficiencyMpg,
      truckEfficiencyMpg: truckEfficiencyMpg
    },
    savings: {
      'savingsReference': 'http://www.carbonfund.org/how-we-calculate',

      'averageCarEfficiencyMpg': averageFuelEfficiencyMpg,
      'versusAverage': getCo2Reference(totalDistanceMiles, averageFuelEfficiencyMpg, autoEmissionsPerGallon) - co2EmittedInKg,

      'smallCarEfficiencyMpg': smallCarEfficiencyMpg,
      'versusSmallCar': getCo2Reference(totalDistanceMiles, smallCarEfficiencyMpg, autoEmissionsPerGallon) - co2EmittedInKg,

      'mediumCarEfficiencyMpg': mediumCarEfficiencyMpg,
      'versusMediumCar': getCo2Reference(totalDistanceMiles, mediumCarEfficiencyMpg, autoEmissionsPerGallon) - co2EmittedInKg
    },
    emissions: {
      "emitted": co2EmittedInKg,
      "units": "kg"
    }
  };

  ride_data['summary'] = rideSummary;

  getMeUser(token, function (err, user) {
    if (err) {
      res.status(500).json(build_error("Error looking up /users/me", err));
    }
    else {

      postTrip(token, ride_data,
        function (err, ride_entity) {
          if (err) {
            res.status(500).json(build_error("Error posting trip", err));
          }
          else {
            async.parallel({
                connectStartStopLocations: function (async_callback) {
                  connectStartStopLocations(token, ride_entity, async_callback);
                },
                connectUserToRide: function (async_callback) {
                  connectEntities(token, user, ride_entity, 'rides', async_callback);
                },
                incrementCounters: function (async_callback) {
                  incrementCounters(user, ride_entity, async_callback);
                }
              },
              function (err, results) {
                if (err) {
                  res.json(err);
                }
                else {
                  console.log(JSON.stringify(results));
                  res.json(rideSummary);
                }
              });
          }
        });
    }
  })
};