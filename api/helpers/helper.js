'use strict';

var geolib = require('geolib'),
  constants = require('./constants');


module.exports.calculateDistanceMeters = function (trip) {
  console.log('calculateDistanceMeters');

  var lastWaypoint = trip['start'];
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
    {latitude: trip['stop']['latitude'], longitude: trip['stop']['longitude']},
    1);

  return totalDistanceMeters;
};


module.exports.getCo2ReferenceInKg = function (totalDistanceMiles, averageFuelEfficiencyMpg, autoEmissionsPerGallon) {
  var gallonsRequired = totalDistanceMiles / averageFuelEfficiencyMpg;
  var response = gallonsRequired * autoEmissionsPerGallon;
  return response;
};

module.exports.getCo2ReferenceInLb = function (totalDistanceMiles, averageFuelEfficiencyMpg, autoEmissionsPerGallon) {
  var inKg = this.getCo2ReferenceInKg(totalDistanceMiles, averageFuelEfficiencyMpg, autoEmissionsPerGallon);
  var response = constants.KG_TO_LB * inKg;
  return response;
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