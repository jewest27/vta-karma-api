var debug = require('debug')('helpers');

module.exports.fb_access_token = function (req) {
  if(req.swagger.params.fb_access_token){
    var key = req.swagger.params.fb_access_token.value;
    if (debug.enabled) { debug('Cache Key: '+key); }
    return key;
  }
  else
  {
    return null;
  }
};

module.exports.access_token = function (req) {
  if(req.swagger.params.access_token){
    var key = req.swagger.params.access_token.value;
    if (debug.enabled) { debug('Cache Key: '+key); }
    return key;
  }
  else
  {
    return null;
  }
};
