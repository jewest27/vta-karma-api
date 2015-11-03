'use strict';

var geolib = require('geolib');


module.exports.calculateDistanceMeters = function (trip) {
  console.log('calculateDistanceMeters');

  var lastWaypoint = trip['tripBegin'];
  var totalDistanceMeters = 0;

  trip.waypoints.forEach(function (thisWaypoint) {
    var d_meters = geolib.getDistance(
      {latitude: lastWaypoint['latitude'], longitude: lastWaypoint['longitude']},
      {latitude: thisWaypoint ['latitude'], longitude: thisWaypoint ['longitude']},
      1);

    lastWaypoint = thisWaypoint;
    totalDistanceMeters += d_meters;
  });

  totalDistanceMeters += geolib.getDistance(
    {latitude: lastWaypoint['latitude'], longitude: lastWaypoint['longitude']},
    {latitude: trip['tripEnd']['latitude'], longitude: trip['tripEnd']['longitude']},
    1);

  return totalDistanceMeters;
};


module.exports.getCo2Reference = function (totalDistanceMiles, averageFuelEfficiencyMpg, autoEmissionsPerGallon) {
  var gallonsRequired = totalDistanceMiles / averageFuelEfficiencyMpg;
  return gallonsRequired * autoEmissionsPerGallon;
};


module.exports.build_error = function (message, err, statusCode, url) {
  var response = {};

  if (message)
    response['message'] = message;

  if (statusCode)
    response['statusCode'] = statusCode;

  if (err)
    response['targetError'] = err;

  if (url)
    response['url'] = url;

  return response
};