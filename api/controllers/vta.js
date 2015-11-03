'use strict';

var util = require('util'),
  async = require('async'),
  caching = require('../helpers/caching.js'),
  helper = require('../helpers/helper.js'),
  constants = require('../helpers/constants.js'),
  request = require('request');


function incrementCounters(token, userId, ride_entity, callback) {
  var rideSummary = ride_entity.summary;

  console.log('== Incrementing counters... ');

  async.parallel([
      function (async_callback) {
        incrementSavings(token, userId, rideSummary['savings'],
          function (err, data) {
            if (err) {
              console.log(err);
              async_callback(helper.build_error("Error looking incrementing savings counter", err));
            }
            else {
              async_callback(null, data);
            }
          });
      },
      function (async_callback) {
        incrementDistance(token, userId, rideSummary,
          function (err, data) {
            if (err) {
              console.log(err);
              async_callback(helper.build_error("Error looking incrementing savings counter", err));
            }
            else {
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

function incrementSavings(token, userId, savings, callback) {
  console.log('Incrementing Savings...');

  var d = new Date();

  var counterName = 'savings.co2.' + userId.username + '.' + d.getFullYear() + '.' + (d.getMonth() + 1);

  postCounterValue(token, counterName, Math.round(savings['versusAverage'], 1), callback);
}

function postCounterValue(token, counterName, value, callback) {

  var counterData = {
    'timestamp': 0,
    'counters': {}
  };

  counterData['counters'][counterName] = value;

  request({
      url: constants.APP_URL + '/events',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
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


function incrementDistance(token, userId, tripSummary, callback) {
  console.log('Incrementing distance...');

  var d = new Date();

  var counterName = 'distance.' + userId.username + '.' + d.getFullYear() + '.' + (d.getMonth() + 1);

  postCounterValue(token, counterName, Math.round(tripSummary.distanceTraveled.miles, 1), callback);

}

function postTrip(token, ride_data, callback) {
  console.log('postTrip');

  request({
      url: constants.APP_URL + '/rides',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify(ride_data)
    },
    function (err, response, body) {
      if (err) {
        if (callback)
          callback(err)
      } else if (response.statusCode != 200) {
        if (callback)
          callback("Response status code " + response.statusCode + ": " + body)
      }
      else {
        var sendMe = JSON.parse(body);
        if (callback) callback(null, sendMe.entities[0])
      }
    });
}

function getNearestStop(token, waypoint, callback) {

  var key = JSON.stringify(waypoint);

  if (!key) {
    if (callback)
      callback("Key must be defined");
  }
  else {
    caching.stopCacheLookup(key, function (err, data) {

      if (err) {
        console.log('Error getting nearest: ' + err);

        if (callback)
          callback(err);
      }

      else if (data) {
        if (callback)
          callback(null, JSON.parse(data));
      }

      else {
        request({
            url: constants.APP_URL + '/stops',
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

              if (callback)
                callback(err);
            }

            else {
              if (response.statusCode == 200) {
                var response_json = JSON.parse(body);

                if (response_json['entities'] && response_json['entities'].length > 0) {
                  var responseEntity = response_json['entities'][0];

                  if (callback)
                    callback(null, responseEntity);

                  caching.stopCacheSet(key, JSON.stringify(responseEntity));
                }
                else {
                  console.log('Did not find a stop within 10 meters of: ' + key + '!');
                  callback(null, {
                    name: 'default',
                    type: 'stop'
                  });
                }
              }
              else {
                callback(helper.build_error('Error looking up closest stop tp: ' + key, body, response.statusCode));
              }
            }
          });
      }
    });
  }
}

function connectEntities(token, source_entity, target_entity, verb, callback) {
  //console.log(constants.APP_URL + '/' + source_entity['type'] + '/' + source_entity.uuid + '/' + verb + '/' + target_entity.uuid);
  console.log('connectEntities');

  if (!source_entity['type'])
    console.log(JSON.stringify(source_entity));

  var url = constants.APP_URL + '/' + source_entity['type'] + '/' + source_entity.uuid + '/' + verb + '/' + (target_entity.uuid ? target_entity.uuid : (target_entity.type + '/' + target_entity.name));

  request({
      url: url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      }
    },
    function (error, response, body) {
      if (error) {
        callback(helper.build_error('Error connecting entities', error, null, url))

      } else if (response.statusCode != 200) {
        console.trace('ERROR: ' + url);
        callback(helper.build_error('Error connecting entities', body, response.statusCode, url));
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
  }, fx_callback);
}

function getCounterValue(token, counterName, callback) {

  request({
      method: 'GET',
      url: constants.APP_URL + '/counters?counter=' + counterName,
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
          callback(helper.build_error('Unable to get counter value: ' + counterName, body, response.statusCode));
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
            callback(helper.build_error('Unable to get counter value: ' + counterName));
        }
      }
    });
}

function getSavings(token, profileData, callback) {
  console.log('getSavings');

  var d = new Date();

  async.parallel({
    unit: async.constant('Kg'),

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

function getDistance(token, profileData, callback) {
  console.log('getDistance');

  var d = new Date();

  async.parallel({
    unit: async.constant('mi'),
    all: function (callback) {
      getCounterValue(token, 'distance.' + profileData.username, callback)
    },
    year: function (callback) {
      getCounterValue(token, 'distance.' + profileData.username + '.' + d.getFullYear(), callback);
    },
    month: function (callback) {
      getCounterValue(token, 'distance.' + profileData.username + '.' + d.getFullYear() + '.' + (d.getMonth() + 1), callback)
    }
  }, callback);
}

function getMeUser(token, callback) {
  console.log('getMeUser');

  caching.profileCacheLookup(token, function (err, data) {
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
          url: constants.APP_URL + '/users/me',
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
                callback(helper.build_error('Error getting /users/me', body, response.statusCode));
            }
            else {
              //console.log('Retrieved user: ' + body);
              var user_response = JSON.parse(body);

              if (callback)
                callback(null, user_response.entities[0]);

              caching.profileCacheSet(token, JSON.stringify(user_response.entities[0]));
            }
          }
        });
    }
  });
}

module.exports.getRideById = function (req, res) {
  request({
      method: 'GET',
      url: constants.APP_URL + '/rides/' + req.swagger.params.tripId.value,
      headers: {
        'Authorization': 'Bearer ' + req.swagger.params.access_token.value
      }
    },
    function (err, response, body) {
      if (err) {
        console.log(err);
        res.status(500).json(helper.build_error("Error looking up stops", err));
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
      url: constants.APP_URL + '/auth/facebook',
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

  if(req.swagger.params.skipCache){
    caching.clearProfileCache()
  }

  getMeUser(req.swagger.params.access_token.value,
    function (err, profile_data) {
      if (err) {
        res.status(500).json(helper.build_error("Error looking up /users/me", err));
      }
      else {
        async.parallel({
            savings: function (callback) {
              getSavings(req.swagger.params.access_token.value, profile_data, callback);
            },
            distance: function (callback) {
              getDistance(req.swagger.params.access_token.value, profile_data, callback);
            }
          },
          function (err, results) {
            if (err) {
              console.log(err);
              res.json(profile_data);
            }

            if (results) {
              profile_data['savings'] = results.savings;

              profile_data['distance'] = results.distance;
              profile_data['facebook']['location'] = 'Canadia, CA';
              res.json(profile_data);
            }
          });
      }
    });
};

module.exports.getStopById = function (req, res) {
  request({
      method: 'GET',
      url: constants.APP_URL + '/stops/' + req.swagger.params.stopId.value,
      headers: {
        'Authorization': 'Bearer ' + req.swagger.params.access_token.value
      }
    },
    function (err, response, body) {
      if (err) {
        console.log(err);
        res.status(500).json(helper.build_error("Error looking up stops", err));
      }
      else {
        var entities = JSON.parse(body).entities;
        res.json(entities);
      }
    });
};

module.exports.getNearestStops = function (req, res) {
  request({
      method: 'GET',
      url: constants.APP_URL + '/stops',
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
        res.status(500).json(helper.build_error("Error looking up stops", err));
      }
      else {
        res.json(JSON.parse(body).entities);
      }
    });
};

module.exports.getRides = function (req, res) {

  request({
      method: 'GET',
      url: constants.APP_URL + '/users/me/rides',
      headers: {
        'Authorization': 'Bearer ' + req.swagger.params.access_token.value
      }
    },
    function (err, response, body) {

      if (err) {
        res.stattus(500).json(helper.build_error("Error looking up /users/me/trips", err));
      } else if (response.statusCode != 200) {
        res.status(500).json("Response status code " + response.statusCode + ": " + body);
      }

      else {
        var entities = JSON.parse(body).entities;
        res.json({rides: entities});

      }
    });
};

module.exports.postRide = function (req, res) {
  var ride_data = req.swagger.params.ride.value;
  var token = req.swagger.params.access_token.value;

  var totalDistanceMeters = helper.calculateDistanceMeters(ride_data);

  var totalDistanceMiles = totalDistanceMeters / constants.metersInMile;
  var co2EmittedInKg = totalDistanceMiles * constants.busEmissionsPerMile;

  var rideSummary = {
    distanceTraveled: {
      'meters': totalDistanceMeters,
      'miles': totalDistanceMeters / constants.metersInMile
    },
    reference: {
      busEmissionsPerMile: constants.busEmissionsPerMile,
      autoEmissionsPerGallon: constants.autoEmissionsPerGallon,
      averageFuelEfficiencyMpg: constants.averageFuelEfficiencyMpg,
      smallCarEfficiencyMpg: constants.smallCarEfficiencyMpg,
      mediumCarEfficiencyMpg: constants.mediumCarEfficiencyMpg,
      truckEfficiencyMpg: constants.truckEfficiencyMpg
    },
    savings: {
      'savingsReference': 'http://www.carbonfund.org/how-we-calculate',

      'averageCarEfficiencyMpg': constants.averageFuelEfficiencyMpg,
      'versusAverage': helper.getCo2Reference(totalDistanceMiles, constants.averageFuelEfficiencyMpg, constants.autoEmissionsPerGallon) - co2EmittedInKg,

      'smallCarEfficiencyMpg': constants.smallCarEfficiencyMpg,
      'versusSmallCar': helper.getCo2Reference(totalDistanceMiles, constants.smallCarEfficiencyMpg, constants.autoEmissionsPerGallon) - co2EmittedInKg,

      'mediumCarEfficiencyMpg': constants.mediumCarEfficiencyMpg,
      'versusMediumCar': helper.getCo2Reference(totalDistanceMiles, constants.mediumCarEfficiencyMpg, constants.autoEmissionsPerGallon) - co2EmittedInKg
    },
    emissions: {
      "emitted": co2EmittedInKg,
      "units": "kg"
    }
  };

  ride_data['summary'] = rideSummary;

  getMeUser(token, function (err, user) {
    if (err) {
      console.log(err);
      res.status(500).json(helper.build_error("Error looking up /users/me", err));
    }

    else {
      console.log('got ME');

      ride_data['username'] = user.username;

      postTrip(token, ride_data,
        function (err, ride_entity) {
          if (err) {
            console.log(err);
            res.status(500).json(helper.build_error("Error posting trip", err));
          }
          else {
            console.log('trip posted...');

            async.parallel({
                connectStartStopLocations: function (async_callback) {
                  console.log('connectStartStopLocations');
                  connectStartStopLocations(token, ride_entity, async_callback);
                },
                connectUserToRide: function (async_callback) {
                  console.log('connectUserToRide');
                  connectEntities(token, user, ride_entity, 'rides', async_callback);
                },
                incrementCounters: function (async_callback) {
                  console.log('incrementCounters');
                  incrementCounters(token, user, ride_entity, async_callback);
                }
              },
              function (err, results) {
                if (err) {
                  console.log(err);
                  res.json(err);
                }
                else {
                  //console.log(JSON.stringify(results));
                  res.json(rideSummary);
                }
              });
          }
        });
    }
  })
};