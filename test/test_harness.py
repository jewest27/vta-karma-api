import requests
import json
import sys
import calendar
import time

start_time = calendar.timegm(time.gmtime()) * 1000
print start_time

ride1 = {
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

trips = {
    1: [
        {
            "latitude": 37.249785940999999,
            "longitude": -121.91032390399999,
        },
        {
            "latitude": 37.291006543000002,
            "longitude": -121.986050814,
        },

        {
            "latitude": 37.326974251000003,
            "longitude": -122.014619901,
        },
        {
            "latitude": 37.393527478000003,
            "longitude": -122.14602014499999,
        },
        {
            "latitude": 37.418700340999997,
            "longitude": -122.14516253399999,
        }],

    2: [
        {
            "latitude": "37.248516342999999",
            "longitude": "-121.830562117",
        },
        {
            "latitude": "37.257781026000004",
            "longitude": "-121.86092731799999",
        },

        {
            "latitude": "37.39502229",
            "longitude": "-122.14328113800001",
        },
        {
            "latitude": "37.409267341000003",
            "longitude": "-122.14692989700001",
        },
        {
            "latitude": "37.418558691000001",
            "longitude": "-122.14510612300001",
        }],
    3: [
        {
            "latitude": "37.409267341000003",
            "longitude": "-122.14692989700001"
        },
        {
            "latitude": "37.39502229",
            "longitude": "-122.14328113800001"
        },

        {
            "latitude": "37.310600057999999",
            "longitude": "-121.916692838"
        },
        {
            "latitude": "37.351626830999997",
            "longitude": "-121.82708783699999"
        },
        {
            "latitude": "37.327474000000002",
            "longitude": "-121.81111799999999"
        }],
    4: [
        {
            "latitude": "37.085301428999998",
            "longitude": "-121.61038320900001"
        },
        {
            "latitude": "37.130110491000003",
            "longitude": "-121.650005026"
        },

        {
            "latitude": "37.330167643000003",
            "longitude": "-121.88975432399999"
        },
        {
            "latitude": "37.335557063000003",
            "longitude": "-121.89013135"
        },
        {
            "latitude": "37.32894718",
            "longitude": "-121.90351130000001"
        }],
}


def build_ride(waypoints, trip_start=start_time):
    return {
        "tripBegin": {
            "latitude": float(waypoints[0]['latitude']),
            "longitude": float(waypoints[0]['latitude']),
            "timestamp": trip_start
        },
        "waypoints": [
            {
                "latitude": float(waypoints[1]['latitude']),
                "longitude": float(waypoints[1]['latitude']),
                "timestamp": trip_start + (10 * 1 * 1000)
            },
            {
                "latitude": float(waypoints[2]['latitude']),
                "longitude": float(waypoints[2]['latitude']),
                "timestamp": trip_start + (10 * 2 * 1000)
            },
            {
                "latitude": float(waypoints[3]['latitude']),
                "longitude": float(waypoints[3]['latitude']),
                "timestamp": trip_start + (10 * 3 * 1000)
            }
        ],
        "tripEnd": {
            "latitude": float(waypoints[4]['latitude']),
            "longitude": float(waypoints[4]['latitude']),
            "timestamp": trip_start + (10 * 4 * 1000)
        }
    }


# url_base = 'http://localhost:10010/v1'
url_base = 'http://vta-prod.apigee.net/karma/v1'

fb_access_token = sys.argv[1]

print fb_access_token

token_endpoint = '%s/token?fb_access_token=%s' % (url_base, fb_access_token)

headers = {
    'content-type': 'application/json'
}

r = requests.get(url=token_endpoint + '', headers=headers)

print r.status_code

if r.status_code != 200:
    print r.text
    exit()

token_response = r.json()
access_token = token_response.get('access_token')

profile_endpoint = '%s/me/profile' % url_base
user_trips_endpoint = '%s/me/rides' % url_base

print 'Access Token: ' + access_token

headers = {
    'content-type': 'application/json',
    'access_token': access_token,
    'skipCache': True
}

for number, trip_points in trips.iteritems():
    ride_data = build_ride(trip_points)
    # print user_trips_endpoint
    print 'posting ride...'
    r = requests.post(url=user_trips_endpoint,
                      data=json.dumps(ride_data),
                      headers=headers)

    print '[%s]: %s ' % (r.status_code, r.text)

#
# r = requests.get(url=user_trips_endpoint,
#                  headers=headers)
# trips = r.json()
# print r.text
# print 'TRIPS!! count: %s' % len(trips)
#
# location = {
#     "latitude": 37.389401339999999,
#     "longitude": -121.85650542
# }
#
# stops_url = '{url_base}/stops?latitude={latitude}&longitude={longitude}&radius=10'.format(url_base=url_base,
#                                                                                           **location)
#
# r = requests.get(url=stops_url,
#                  headers=headers)
# stops = r.json()
# print r.text
#
user_profile_url = '{url_base}/me/profile'.format(url_base=url_base)

r = requests.get(url=user_profile_url,
                 headers=headers)
print r.text
