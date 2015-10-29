'use strict';

var util = require('util'),
  async = require('async'),
  usergrid = require('usergrid'),
  geolib = require('geolib'),
  Q = require('q'),
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
  console.log('calculateDistanceMeters');

  var lastWaypoint = trip['tripBegin'];
  var totalDistanceMeters = 0;

  var arrayLength = trip['waypoints'].length;
  console.log('Waypoints: ' + arrayLength);

  var d_meters = 0.0;

  trip.waypoints.forEach(function (thisWaypoint) {
    console.log('foreach waypoint');
    var d_meters = geolib.getDistance(
      {latitude: lastWaypoint['latitude'], longitude: lastWaypoint['longitude']},
      {latitude: thisWaypoint ['latitude'], longitude: thisWaypoint ['longitude']},
      1
    );

    lastWaypoint = thisWaypoint;
    totalDistanceMeters += d_meters;
  });

  console.log('final waypoint');
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

  if (callback == null) {
    deferred = Q.defer()
  }
  //console.log('Nearest: ' + JSON.stringify(waypoint));
  var queryString = 'select * where location within 10 of ' + waypoint['latitude'] + ', ' + waypoint['longitude'];
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

        if (deferred == null)
          callback(err);
        else
          deferred.reject(err);
      }
      else {
        if (response && response['entities'] && response['entities'].length > 0) {
          var responseEntity = response['entities'][0];
          if (deferred == null)
            callback(null, new usergrid.entity({data: responseEntity}));
          else
            deferred.resolve(new usergrid.entity({data: responseEntity}));
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
              deferred.resolve(counter.values[0].value)
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

function getMeUser(token, callback) {

  var meUrl = BAAS_URL + '/' + BAAS_ORG_NAME + '/' + BAAS_APP_NAME + '/users/me';
  console.log(meUrl);
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

        console.log(err);

        if (callback)
          callback({
            err: err
          });

      }
      else {

        console.log("Response status code " + response.statusCode + ": " + body);

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
        }
      }
    });
}

module.exports.getRideById = function (req, res) {
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

  var meUrl = BAAS_URL + '/' + BAAS_ORG_NAME + '/' + BAAS_APP_NAME + '/auth/facebook';

  var fb_access_token = req.swagger.params.fb_access_token.value;

  console.log('fb_access_token=' + fb_access_token);

  var options = {
    method: 'GET',
    url: meUrl,
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
        }
      }
    });
};

module.exports.getProfile = function (req, res) {

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
        getSavings(req.swagger.params.access_token.value,
          profile_data, function (err, savings_data) {
            console.log('SAVINGS: ' + JSON.stringify(savings_data));
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
  var token = req.swagger.params.access_token.value;

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

  console.log(url);

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
}

module.exports.getRides = function (req, res) {

  var token = req.swagger.params.access_token.value;

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
        res.json({rides: entities});
      }
    });

};

module.exports.postTrip = function (req, res) {
  console.log('posting trip..');
  var ride = req.swagger.params.ride.value;
  var token = req.swagger.params.access_token.value;

  client.setToken(token);

  var userId = req.swagger.params.userId.value;

  var totalDistanceMeters = calculateDistanceMeters(ride);

  var totalDistanceMiles = totalDistanceMeters / metersInMile;
  var co2EmittedInKg = totalDistanceMiles * busEmissionsPerMile;

  var tripSummary = {
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
      tripSummary['start'] = data.data;
    },
    function (err) {
    }
  );

  endStop.then(
    function (data) {
      console.log('retrieved finish stop: ' + JSON.stringify(data));
      tripSummary['finish'] = data.data;
    },
    function (err) {
    }
  );

  Q.allSettled([beginStop, endStop]).then(function (results) {
    //console.log('settled');
    ride['summary'] = tripSummary;

    getMeUser(token, function (err, meUser) {
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
              var tripId = ride_entity.get('uuid');
              console.log('Trip ID: ' + tripId);

              tripSummary['rideId'] = tripId;

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
                    incrementSavings(userId, tripSummary['savings'],
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
                    res.json(tripSummary);
                  }
                }
              );
            }
          });
    })
  })
};