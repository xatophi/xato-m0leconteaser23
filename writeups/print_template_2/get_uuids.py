import requests
import random
import base64
import json

chall_url = 'http://localhost:3000'

u = str(random.randint(0,1000000000000))
p = str(random.randint(0,1000000000000))

print(u,p)

s1 = requests.Session()

r1 = requests.post(chall_url + '/register', data={'username': u, 'password': p}) # 32 + 21
r2 = requests.post(chall_url + '/register', data={'username': u + '_2' , 'password': p}) # 32 + 21
#r3 = requests.post(chall_url + '/register', data={'username': u + '_3' , 'password': p}) # 32 + 21

r1 = s1.post(chall_url + '/login', data={'username': u, 'password': p}) # 21 + 21
r2 = requests.post(chall_url + '/login', data={'username': u + '_2' , 'password': p}) # 21 + 21
#r3 = requests.post(chall_url + '/login', data={'username': u + '_3' , 'password': p}) # 21 + 21

id1 = json.loads(base64.b64decode(r1.history[-1].cookies['session'].split('.')[1] + '==='))['user']
id2 = json.loads(base64.b64decode(r2.history[-1].cookies['session'].split('.')[1] + '==='))['user']
#id3 = json.loads(base64.b64decode(r3.history[-1].cookies['session'].split('.')[1] + '==='))['user']

print('\nValues to use in the sage script:')
print(id1)
print(id2)
#print(id3)


r = requests.post(chall_url + '/new-request', cookies={'session': s1.cookies['session']}, data={'message': 'aaa', 'csrf':'aFcm48md-MpuTca5CpoL8riRxhQh24facBpE'}, files={'file': b'fileee'})

#print(r)
#print(r.text)

r = requests.post(chall_url + '/register', data={'username': u + 'check', 'password': p}) 
#print(r)
r = requests.post(chall_url + '/login', data={'username': u + 'check' , 'password': p}) # 21 + 21
idcheck = json.loads(base64.b64decode(r.history[-1].cookies['session'].split('.')[1] + '==='))['user']


print('\nCheck value: ' + idcheck)

# r = s1.get(chall_url + '/review')
# print(r)