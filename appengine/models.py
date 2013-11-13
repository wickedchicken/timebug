from google.appengine.ext import ndb

class Task(ndb.Model):
  name = ndb.StringProperty()
  created = ndb.DateTimeProperty(auto_now_add=True)
  modified = ndb.DateTimeProperty(auto_now=True)
  estimate = ndb.FloatProperty()
  actual = ndb.FloatProperty(default=0.0)
  finished = ndb.BooleanProperty(default=False)

class User(ndb.Model):
  last_seen = ndb.DateTimeProperty(auto_now=True)
  last_seen_email = ndb.StringProperty()
  wants_email = ndb.BooleanProperty(default=False)

  @staticmethod
  def create_or_update(parent, email, wants_email):
    db_user = User.get_or_insert(parent)
    db_user.last_seen_email = email
    if wants_email is not None:
      db_user.wants_email = wants_email
    db_user.put()
