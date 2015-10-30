import requests
import json
import sys
import calendar
import time

start_time = calendar.timegm(time.gmtime()) * 1000
print start_time

ride_data = {
    "tripBegin": {
        "latitude": 37.249785940999999,
        "longitude": -121.91032390399999,
        "timestamp": start_time
    },
    "waypoints": [
        {
            "latitude": 37.291006543000002,
            "longitude": -121.986050814,
            "timestamp": start_time + (10 * 1 * 1000)
        },
        {
            "latitude": 37.326974251000003,
            "longitude": -122.014619901,
            "timestamp": start_time + (10 * 2 * 1000)
        },
        {
            "latitude": 37.393527478000003,
            "longitude": -122.14602014499999,
            "timestamp": start_time + (10 * 3 * 1000)
        }
    ],
    "tripEnd": {
        "latitude": 37.418700340999997,
        "longitude": -122.14516253399999,
        "timestamp": start_time + (10 * 4 * 1000)
    }
}

url_base = 'http://localhost:10010/v1'

fb_access_token = sys.argv[1]

print fb_access_token

token_endpoint = '%s/token?fb_access_token=%s' % (url_base, fb_access_token)

headers = {
    'content-type': 'application/json'
}

r = requests.get(url=token_endpoint + '', headers=headers)

if r.status_code != 200:
    print r.text

if r.status_code == 200:
    token_response = r.json()
    access_token = token_response.get('access_token')

    profile_endpoint = '%s/me/profile' % url_base
    user_trips_endpoint = '%s/me/rides' % url_base

    print 'Access Token: ' + access_token

    headers['access_token'] = access_token

    r = requests.post(url=user_trips_endpoint,
                      data=json.dumps(ride_data),
                      headers=headers)

    if r.status_code != 200:
        print r.text
    else:
        r = requests.get(url=user_trips_endpoint,
                         headers=headers)
        trips = r.json()
        print r.text
        print 'TRIPS!! count: %s' % len(trips)

location = {
    "latitude": 37.389401339999999,
    "longitude": -121.85650542
}

stops_url = '{url_base}/stops?latitude={latitude}&longitude={longitude}&radius=10'.format(url_base=url_base, **location)

r = requests.get(url=stops_url,
                 headers=headers)
stops = r.json()
print r.text


user_profile_url = '{url_base}/me/profile'.format(url_base=url_base)

r = requests.get(url=user_profile_url,
                 headers=headers)
print r.text

