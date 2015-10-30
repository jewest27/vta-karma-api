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

var metersInMile = 1609.34;

var busEmissionsPerMile = 0.107;
var autoEmissionsPerGallon = 8.91;

var averageFuelEfficiencyMpg = 23.6;
var smallCarEfficiencyMpg = 40;
var mediumCarEfficiencyMpg = 30;
var truckEfficiencyMpg = 17;

var profile_cache = cache_memory.create('profile-cache');

var options = {
  URI: BAAS_URL,
  orgName: BAAS_ORG_NAME,
  appName: BAAS_APP_NAME,
  authType: usergrid.AUTH_APP_USER
};

var LOG = false;
var client = new usergrid.client(options);

function connectRide(token, rideEntity, callback) {
  console.log('Connecting ride...');

  var url = BAAS_URL + '/' + BAAS_ORG_NAME + '/' + BAAS_APP_NAME + '/users/me/rides/' + rideEntity['uuid'];

  client.getEntity({
      type: 'users',
      'name': 'me'
    },
    function (err, user_entity) {
      user_entity.connect("rides", rideEntity,
        function (err, data) {
          if (err) {
            console.log('ERROR: ' + err);
            callback(err);
          }
          else {
            console.log('CONNEcT SUCCESS: ' + data);
            callback(null, data);
          }
        })
    });
}

function calculateDistanceMeters(trip) {
  console.log('calculateDistanceMeters');

  var lastWaypoint = trip['tripBegin'];
  var totalDistanceMeters = 0;

  var arrayLength = trip['waypoints'].length;
  //console.log('Waypoints: ' + arrayLength);

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

function incrementSavings(userId, savings, callback) {
  console.log('Incrementing Savings...');

  var d = new Date();

  var counterName = 'savings.co2.' + userId + '.' + d.getFullYear() + '.' + (d.getMonth() + 1);
  var counterData = {
    'timestamp': 0,
    'counters': {}
  };

  counterData['counters'][counterName] = Math.round(savings['versusAverage'], 1);

  var eventUrl = BAAS_URL + '/' + BAAS_ORG_NAME + '/' + BAAS_APP_NAME + '/events';

  console.log('Counter Name: ' + counterName);

  request({
      url: eventUrl,
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

function postTrip(ride_data, callback) {
  client.createEntity({type: 'rides'},
    function (err, ride) {
      if (err) {
        callback(err)
      }
      else {
        ride.set(ride_data);
        ride.save(function (err) {
          if (err) {
            callback(err)
          }
          else {
            callback(null, ride);
          }
        });
      }
    }
  );
}

function getNearestStop(waypoint, callback) {
  var deferred;

  var cache = req.a127.resource('nearest-stop-cache');
  var key = JSON.stringify(waypoint);

  //if (cache)
  //  console.log('Found cache: nearest-stop-cache');
  //else
  //  console.log('NO cache: nearest-stop-cache');

  checkCache(cache, key, function (err, data) {
      if (err)
        callback(err);

      else if (data) {
        console.log('Cache hit on nearest-stop-cache for key: ' + key);
        callback(null, JSON.parse(data));
      }
      else {
        if (callback == null) {
          deferred = Q.defer()
        }

        var queryString = 'select * where location within 10 of ' + waypoint['latitude'] + ', ' + waypoint['longitude'];
        //console.log('getting nearest stop, ql=' + queryString);

        var options = {
          endpoint: 'stop',
          type: 'stop',
          qs: {ql: queryString}
        };

        client.request(options,
          function (err, response) {
            if (err) {
              console.log(err);

              if (deferred == null)
                callback(err);
              else
                deferred.reject(err);
            }
            else {
              if (response && response['entities'] && response['entities'].length > 0) {

                var responseEntity = response['entities'][0];
                var my_response = new usergrid.entity({data: responseEntity});

                if (deferred == null)
                  callback(null, my_response);
                else
                  deferred.resolve(my_response);

                if (cache)
                  cache.set(key, JSON.stringify(my_response));
              }

              else {

                client.getEntity({type: "stop", name: "default"},
                  function (err, entity) {
                    if (err) {
                      console.log(err);

                      if (deferred == null)
                        callback(err);
                      else
                        deferred.reject(err);
                    }
                    else {
                      if (cache)
                        cache.set(key, JSON.stringify(entity));

                      if (deferred == null)
                        callback(null, entity);
                      else
                        deferred.resolve(entity);
                    }
                  })
              }
            }
          });

        if (deferred != null)
          return deferred.promise;
      }
    }
  )
  ;
}

function connectStartStopLocations(ride_entity, fx_callback) {

  async.parallel([
      function (callback) {
        getNearestStop(ride_entity.get('tripBegin'),
          function (err, ride_start_entity) {
            if (err) {
              console.log(err);
              callback(err);
            }
            else {
              ride_entity.connect("beginsAt", ride_start_entity,
                function (err, data) {
                  if (err) {
                    console.log(err);
                    callback(err);
                  }
                  else {
                    console.log('Successfully created tripStart connection');
                    callback(null, data);
                  }
                });
            }
          });
      },
      function (callback) {
        getNearestStop(ride_entity.get('tripEnd'),
          function (err, trip_stop_entity) {
            if (err) {
              console.log(err);
              callback(err);
            }
            else {
              ride_entity.connect("endsAt", trip_stop_entity,
                function (err, data) {
                  if (err) {
                    console.log(err);
                    callback(err);
                  }
                  else {
                    console.log('Successfully created tripStop connection');
                    callback(null, data);
                  }
                });
            }
          });
      }],

    function (err, results) {
      if (err) {
        console.log(err);
        fx_callback(err);
      }
      else {
        fx_callback(null, results);
      }
    });

}

function getCounterValue(token, counterName) {
  var deferred = Q.defer();

  var meUrl = BAAS_URL + '/' + BAAS_ORG_NAME + '/' + BAAS_APP_NAME + '/counters?counter=' + counterName;

  var options = {
    method: 'GET',
    url: meUrl,
    headers: {
      'Authorization': 'Bearer ' + token
    }
  };

  request(options,
    function (err, response, body) {

      if (err) {
        deferred.reject(err);
      }
      else {
        //todo: handle non 200

        if (response.statusCode == 200) {
          var response_json = JSON.parse(body);
          var found = false;

          response_json.counters.forEach(function (counter) {
            if (counter.name == counterName) {
              found = true;
              if (counter.values.length > 0)
                deferred.resolve(counter.values[0].value);
              else
                deferred.resolve(0)
            }
          });

          if (!found)
            deferred.reject('Unable to get counter value: ' + counterName);
        }
      }
    });

  return deferred.promise;
}

function getSavings(token, profileData, callback) {
  console.log('getSavings');

  var d = new Date();

  var response = {
    month: 10,
    year: 100,
    all: 1000
  };

  //console.log('USER: '+JSON.stringify(profileData));

  var userId = profileData.username;
  var counterAll = 'savings.co2.' + userId;
  var counterYear = 'savings.co2.' + userId + '.' + d.getFullYear();
  var counterMonth = 'savings.co2.' + userId + '.' + d.getFullYear() + '.' + (d.getMonth() + 1);

  var promise_counter_all = getCounterValue(token, counterAll);
  var promise_counter_month = getCounterValue(token, counterMonth);
  var promise_counter_year = getCounterValue(token, counterYear);

  promise_counter_year.then(function (data) {
    response.year = data;
  });

  promise_counter_month.then(function (data) {
    response.month = data;
  });

  promise_counter_all.then(function (data) {
    response.all = data;
  });

  Q.allSettled([promise_counter_all, promise_counter_month, promise_counter_year]).then(function () {
    callback(null, response);
  });
}

function checkCache(cache, key, callback) {

  if (cache) {
    cache.get(key, function (err, data) {
      if (data)
        console.log('Cache hit on ' + cache.name + ' for key: ' + key);
      else
        console.log('Cache miss on ' + cache.name + ' for key: ' + key);

      callback(err, data);
    });
  }
  else {
    console.log('Attempted to check cache which does not exist!');
    callback(null, null);
  }
}

function getMeUser(token, callback) {
  console.log('getMeUser');

  var cache = profile_cache;

  var key = token;

  //if (cache)
  //  console.log('Found cache: user-cache');
  //else
  //  console.log('NO cache: user-cache');

  checkCache(cache, token, function (err, data) {
    if (err)
      callback(err);
    else if (data) {
      callback(null, JSON.parse(data));
    }
    else {
      var meUrl = BAAS_URL + '/' + BAAS_ORG_NAME + '/' + BAAS_APP_NAME + '/users/me';
      console.log(meUrl);
      var options = {
        method: 'GET',
        url: meUrl,
        headers: {
          'Authorization': 'Bearer ' + token
        }
      };

      request(options, function (err, response, body) {
        if (err) {
          console.log(err);
          if (callback)
            callback(err);
        }
        else {

          if (response.statusCode != 200) {
            if (callback)
              callback({
                usergridStatusCode: response.statusCode,
                usergridResponse: JSON.parse(body)
              });
          }
          else {
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
  var cache = req.a127.resource('ride-cache');

  var token = req.swagger.params.access_token.value;

  var url = BAAS_URL + '/' + BAAS_ORG_NAME + '/' + BAAS_APP_NAME + '/rides/' + req.swagger.params.tripId.value;
  var options = {
    method: 'GET',
    url: url,
    headers: {
      'Authorization': 'Bearer ' + token
    }
  };

  console.log(url);

  request(options,
    function (err, response, body) {
      if (err) {
        console.log(err);
        res.status(500).json({
          message: "Error looking up stops",
          usergridError: err
        });
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

  var fb_access_token = req.swagger.params.fb_access_token.value;
  var key = fb_access_token;

  console.log('fb_access_token=' + fb_access_token);

  var cache = req.a127.resource('token-cache');

  //if (cache)
  //  console.log('Found cache: token-cache');
  //else
  //  console.log('NO cache: token-cache');

  checkCache(cache, fb_access_token, function (err, data) {
    if (err)
      callback(err);

    else if (data) {
      callback(null, JSON.parse(data));
    }
    else {

      var url = BAAS_URL + '/' + BAAS_ORG_NAME + '/' + BAAS_APP_NAME + '/auth/facebook';

      var options = {
        method: 'GET',
        url: url,
        qs: {
          'fb_access_token': fb_access_token
        },
        headers: {
          'Content-Type': 'application/json'
        }
      };

      request(options,
        function (err, response, body) {
          if (err) {
            callback(err);
          }
          else {
            if (response.statusCode != 200) {
              res.json(body);
            }
            else {
              var user_response = JSON.parse(body);

              res.json(user_response);

              if (cache)
                cache.set(fb_access_token, body);
            }
          }
        });
    }
  });


};

module.exports.getProfile = function (req, res) {

  var cache = req.a127.resource('profile-cache');
  var key = req.swagger.params.access_token.value;

  //if (cache)
  //  console.log('Found cache: profile-cache');
  //else
  //  console.log('NO cache: profile-cache');

  checkCache(cache, key, function (err, data) {
    if (err)
      res.status(500).json(err);

    else if (data) {
      res.json(JSON.parse(data));
    }

    else {

      getMeUser(req.swagger.params.access_token.value,
        function (err, profile_data) {
          if (err) {
            res.status(500).json(
              {
                message: "Error looking up /users/me",
                usergridError: err
              });
          }
          else {
            getSavings(req.swagger.params.access_token.value, profile_data,

              function (err, savings_data) {
                console.log('SAVINGS: ' + JSON.stringify(savings_data));

                profile_data['savings'] = savings_data;

                res.json(profile_data);

                if (cache)
                  cache.set(key, JSON.stringify(profile_data));
              });
          }
        }
      );
    }
  });

};

function getCo2Reference(totalDistanceMiles, averageFuelEfficiencyMpg, autoEmissionsPerGallon) {
  var gallonsRequired = totalDistanceMiles / averageFuelEfficiencyMpg;
  return gallonsRequired * autoEmissionsPerGallon;

}

module.exports.getStopById = function (req, res) {
  var token = req.swagger.params.access_token.value;
  var cache = req.a127.resource('stop-cache');
  var key = req.swagger.params.stopId.value;

  //if (cache)
  //  console.log('Found cache: stop-cache');
  //else
  //  console.log('NO cache: stop-cache');

  checkCache(cache, key,
    function (err, data) {
      if (err)
        callback(err);

      else if (data) {
        callback(null, JSON.parse(data));
      }

      else {

        var url = BAAS_URL + '/' + BAAS_ORG_NAME + '/' + BAAS_APP_NAME + '/stops/' + req.swagger.params.stopId.value;
        var options = {
          method: 'GET',
          url: url,
          headers: {
            'Authorization': 'Bearer ' + token
          }
        };

        console.log(url);

        request(options,
          function (err, response, body) {
            if (err) {
              console.log(err);
              res.status(500).json({
                message: "Error looking up stops",
                usergridError: err
              });
            }
            else {
              var entities = JSON.parse(body).entities;
              res.json(entities);

              if (cache)
                cache.set(key, JSON.stringify(entities));
            }
          });
      }
    });
};

module.exports.getNearestStops = function (req, res) {
  var token = req.swagger.params.access_token.value;

  var url = BAAS_URL + '/' + BAAS_ORG_NAME + '/' + BAAS_APP_NAME + '/stops?ql=select * where location within ' + req.swagger.params.radius.value + ' of ' + req.swagger.params.latitude.value + ',' + req.swagger.params.longitude.value;
  var options = {
    method: 'GET',
    url: url,
    headers: {
      'Authorization': 'Bearer ' + token
    }
  };

  //console.log(url);

  request(options,
    function (err, response, body) {
      if (err) {
        console.log(err);
        res.stattus(500).json({
          message: "Error looking up stops",
          usergridError: err
        });
      }
      else {
        var entities = JSON.parse(body).entities;
        res.json(entities);
      }
    });
};

module.exports.getRides = function (req, res) {

  var token = req.swagger.params.access_token.value;

  var cache = req.a127.resource('rides-cache');
  var key = token;

  //if (cache)
  //  console.log('Found cache: rides-cache');
  //else
  //  console.log('NO cache: rides-cache');

  checkCache(cache, key,
    function (err, data) {
      if (err)
        res.status(500).json(err);

      else if (data) {
        res.json(JSON.parse(data));
      }
      else {

        var url = BAAS_URL + '/' + BAAS_ORG_NAME + '/' + BAAS_APP_NAME + '/users/me/rides';
        var options = {
          method: 'GET',
          url: url,
          headers: {
            'Authorization': 'Bearer ' + token
          }
        };

        request(options,
          function (err, response, body) {

            if (err) {
              res.stattus(500).json({
                message: "Error looking up /users/me/trips",
                usergridError: err
              });

            } else if (response.statusCode != 200) {
              res.status(500).json("Response status code " + response.statusCode + ": " + body);
            }

            else {
              var entities = JSON.parse(body).entities;
              var my_response = {rides: entities};
              res.json(my_response);

              if (cache)
                cache.set(key, JSON.stringify(my_response));
            }
          });
      }
    })
  ;
};

module.exports.postRide = function (req, res) {
  console.log('posting ride..');
  var ride = req.swagger.params.ride.value;
  var token = req.swagger.params.access_token.value;

  client.setToken(token);

  var totalDistanceMeters = calculateDistanceMeters(ride);

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

  var start = ride['tripBegin'];
  var stop = ride['tripEnd'];

  var beginStop = getNearestStop(start);
  var endStop = getNearestStop(stop);

  beginStop.then(
    function (data) {
      console.log('retrieved begin stop: ' + JSON.stringify(data));
      rideSummary['start'] = data.data;
    },
    function (err) {
    }
  );

  endStop.then(
    function (data) {
      console.log('retrieved finish stop: ' + JSON.stringify(data));
      rideSummary['finish'] = data.data;
    },
    function (err) {
    }
  );

  Q.allSettled([beginStop, endStop]).then(function (results) {
    //console.log('settled');
    ride['summary'] = rideSummary;

    getMeUser(token, function (err, meUser) {
      if (err) {
        console.log(err);
        res.status(500).json(
          {
            message: "Error looking up /users/me",
            usergridError: err
          });
      }
      else {
        postTrip(ride,
          function (err, ride_entity) {
            if (err) {
              console.log(err);
              res.status(500).json({
                message: "Error posting trip",
                usergridError: err
              });
            }
            else {
              console.log('Me: ' + JSON.stringify(meUser));
              var tripId = ride_entity.get('uuid');
              console.log('Trip ID: ' + tripId);

              rideSummary['rideId'] = tripId;

              async.parallel([
                  function (async_callback) {
                    connectStartStopLocations(ride_entity,
                      function (err, data) {
                        if (err) {
                          console.log(err);
                          async_callback({
                            message: "Error connecting ride start/stop",
                            usergridError: err
                          });
                        }
                        else {
                          console.log('connected start/stop...');
                          async_callback(null, data);
                        }
                      });
                  },
                  function (async_callback) {
                    connectRide(meUser, ride_entity,
                      function (err, data) {
                        if (err) {
                          console.log(err);
                          async_callback({
                            message: "Error connecting ride to user",
                            usergridError: err
                          });
                        }
                        else {
                          console.log('connected Ride to user: ' + meUser['uuid']);
                          async_callback(null, data);
                        }
                      });
                  },
                  function (async_callback) {
                    incrementSavings(meUser, rideSummary['savings'],
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
                  }],
                function (err, results) {
                  if (err) {
                    res.json(err);
                  }
                  else {
                    res.json(rideSummary);
                  }
                }
              );
            }
          });
      }
    })
  })
};