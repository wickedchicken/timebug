from google.appengine.ext import ndb

class Task(ndb.Model):
  name = ndb.StringProperty()
  created = ndb.DateTimeProperty(auto_now_add=True)
  modified = ndb.DateTimeProperty(auto_now=True)
  estimate = ndb.FloatProperty()
  actual = ndb.FloatProperty(default=0.0)
  finished = ndb.BooleanProperty(default=False)

class User(ndb.Model):
  email = ndb.StringProperty(required=True)
  wants_email = ndb.BooleanProperty(default=False)
