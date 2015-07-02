'use strict';

var util = require('util'),
  async = require('async'),
  usergrid = require('usergrid'),
  geolib = require('geolib'),
  request = require('request');

var BAAS_URL = "https://api.usergrid.com";
var BAAS_ORG_NAME = "vta";
var BAAS_APP_NAME = "sandbox";

var options = {
  URI: BAAS_URL,
  orgName: BAAS_ORG_NAME,
  appName: BAAS_APP_NAME,
  authType: usergrid.AUTH_APP_USER
};
var LOG = false;
var client = new usergrid.client(options);

function connectRide(user, rideEntity, callback) {
  console.log('Connecting ride...');

  client.getEntity(user,
    function (err, user_entity) {
      user_entity.connect("rides", rideEntity,
        function (err, data) {
          if (err)
            callback(err);
          else {
            callback(null, data);
          }
        })
    });
}

function calculateDistanceMeters(trip) {
  var lastWaypoint = trip['start'];
  var totalDistanceMeters = 0;

  var arrayLength = trip['waypoints'].length;

  for (var i = 0; i < arrayLength; i++) {
    var thisWaypoint = trip['waypoints'][i];

    var d_meters = geolib.getDistance(
      {latitude: lastWaypoint['latitude'], longitude: lastWaypoint['longitude']},
      {latitude: thisWaypoint ['latitude'], longitude: thisWaypoint ['longitude']},
      1
    );

    lastWaypoint = thisWaypoint;
    totalDistanceMeters += d_meters;
  }

  d_meters = geolib.getDistance(
    {latitude: lastWaypoint['latitude'], longitude: lastWaypoint['longitude']},
    {latitude: trip['stop']['latitude'], longitude: trip['stop']['longitude']},
    1
  );

  totalDistanceMeters += d_meters;

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

  var eventUrl = 'http://api.usergrid.com/vta/sandbox/events';

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

  var queryString = 'select * where location within 3 of ' + waypoint['latitude'] + ', ' + waypoint['longitude'];
  console.log('getting nearest stop, ql=' + queryString);

  var options = {
    endpoint: 'stop',
    type: 'stop',
    qs: {ql: queryString}
  };

  client.request(options,
    function (err, response) {
      if (err) {
        console.log(err);
        callback(err);
      }
      else {
        if (response && response['entities'] && response['entities'].length > 0) {
          var responseEntity = response['entities'][0];
          callback(null, new usergrid.entity({data: responseEntity}));
        }
        else {
          client.getEntity({type: "stop", name: "default"},
            function (err, entity) {
              if (err) {
                console.log(err);
                callback(err);
              }
              else {
                callback(null, entity);
              }
            })
        }
      }
    });
}

function connectStartStopLocations(ride_entity, fx_callback) {

  async.parallel([
      function (callback) {
        getNearestStop(ride_entity.get('start'),
          function (err, ride_start_entity) {
            if (err) {
              console.log(err);
              callback(err);
            }
            else {
              ride_entity.connect("startsAt", ride_start_entity,
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
        getNearestStop(ride_entity.get('stop'),
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

function getMeUser(callback) {

  var meUrl = BAAS_URL + '/' + BAAS_ORG_NAME + '/' + BAAS_APP_NAME + '/users/me';
  var options = {
    method: 'GET',
    url: meUrl,
    headers: {
      'Authorization': 'Bearer ' + client.getToken()
    }
  };

  request(options,
    function (err, response, body) {
      if (err) {
        callback(err);
      }
      else {
        callback(null, JSON.parse(body).entities[0]);
      }
    });
}

module.exports.getProfile = function (req, res) {

  client.setToken(req.swagger.params.access_token.value);

  getMeUser(req.swagger.params.access_token.value,
    function (err, data) {
      if (err) {
        res.status(500).json(
          {
            message: "Error looking up /users/me",
            usergridError: err
          });
      }
      else {
        res.json(data);
      }
    }
  );
};

function getCo2Reference(totalDistanceMiles, averageFuelEfficiencyMpg, autoEmissionsPerGallon) {
  var gallonsRequired = totalDistanceMiles / averageFuelEfficiencyMpg;
  return gallonsRequired * autoEmissionsPerGallon;

}
module.exports.postTrip = function (req, res) {

  var ride = req.swagger.params.ride.value;
  var token = req.swagger.params.access_token.value;

  client.setToken(token);

  var userId = req.swagger.params.userId.value;

  var apiResponse = {};

  var start = ride['start'];
  var stop = ride['stop'];

  var totalDistanceMeters = calculateDistanceMeters(ride);

  var metersInMile = 1609.34;
  var totalDistanceMiles = totalDistanceMeters / metersInMile;

  var busEmissionsPerMile = 0.107;
  var autoEmissionsPerGallon = 8.91;
  var averageFuelEfficiencyMpg = 23.6;
  var smallCarEfficiencyMpg = 40;
  var mediumCarEfficiencyMpg = 30;
  var truckEfficiencyMpg = 17;

  var co2EmittedInKg = totalDistanceMiles * busEmissionsPerMile;

  apiResponse['distanceTraveled'] = {
    'meters': totalDistanceMeters,
    'miles': totalDistanceMeters / metersInMile
  };

  apiResponse['reference'] = {
    busEmissionsPerMile: busEmissionsPerMile,
    autoEmissionsPerGallon: autoEmissionsPerGallon,
    averageFuelEfficiencyMpg: averageFuelEfficiencyMpg,
    smallCarEfficiencyMpg: smallCarEfficiencyMpg,
    mediumCarEfficiencyMpg: mediumCarEfficiencyMpg,
    truckEfficiencyMpg: truckEfficiencyMpg
  };

  apiResponse['savings'] = {
    'savingsReference': 'http://www.carbonfund.org/how-we-calculate',

    'averageCarEfficiencyMpg': averageFuelEfficiencyMpg,
    'versusAverage': getCo2Reference(totalDistanceMiles, averageFuelEfficiencyMpg, autoEmissionsPerGallon) - co2EmittedInKg,

    'smallCarEfficiencyMpg': smallCarEfficiencyMpg,
    'versusSmallCar': getCo2Reference(totalDistanceMiles, smallCarEfficiencyMpg, autoEmissionsPerGallon) - co2EmittedInKg,

    'mediumCarEfficiencyMpg': mediumCarEfficiencyMpg,
    'versusMediumCar': getCo2Reference(totalDistanceMiles, mediumCarEfficiencyMpg, autoEmissionsPerGallon) - co2EmittedInKg
  };

  apiResponse['emissions'] = {
    "emitted": co2EmittedInKg,
    "units": "kg"
  };

  ride['summary'] = apiResponse;

  getMeUser(function (err, meUser) {
    if (err) {
      console.log(err);
      res.status(500).json(
        {
          message: "Error looking up /users/me",
          usergridError: err
        });
    }
    else
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
            apiResponse['rideId'] = ride_entity.get('uuid');

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
                  incrementSavings(userId, apiResponse['savings'],
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
                  res.json(apiResponse);
                }
              }
            );
          }
        });
  })
};