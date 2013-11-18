"""Tasktimer API implemented using Google Cloud Endpoints."""


import endpoints
import logging
from protorpc import messages
from protorpc import message_types
from protorpc import remote

import models

from google.appengine.ext import ndb

class User(messages.Message):
  last_seen_email = messages.StringField(2)
  wants_email = messages.BooleanField(16)

class Task(messages.Message):
  task_id = messages.IntegerField(1)
  estimate = messages.FloatField(2)
  actual = messages.FloatField(3)
  finished = messages.BooleanField(4)
  modified = message_types.DateTimeField(5)
  created = message_types.DateTimeField(6)
  name = messages.StringField(16)

def update_db_task(db_task, request_task):
  for i in ['estimate', 'actual', 'finished', 'modified', 'created', 'name']:
    if i in (x.name for x in request_task.all_fields()):
      setattr(db_task, i, getattr(request_task, i))

def one_task_to_another(target_class, other_task, parent=None):
  if parent and target_class != Task:
    parent_key=ndb.Key(models.User, parent)

    target = target_class(
        parent=parent_key,
        estimate=other_task.estimate,
        actual=other_task.actual,
        finished=other_task.finished,
        modified=other_task.modified,
        created=other_task.created,
        name=other_task.name)
    logging.info(str(target))
  else:
    target = target_class(
        estimate=other_task.estimate,
        actual=other_task.actual,
        finished=other_task.finished,
        modified=other_task.modified,
        created=other_task.created,
        name=other_task.name)

  if target_class == Task:
    target.task_id = other_task.key.id()

  return target

class TaskCollection(messages.Message):
  """Collection of Greetings."""
  items = messages.MessageField(Task, 1, repeated=True)

ALLOWED_CLIENT_IDS = [
    '471586205082.apps.googleusercontent.com',
    endpoints.API_EXPLORER_CLIENT_ID
]

@endpoints.api(name='tasktimer', version='v1',
    allowed_client_ids=ALLOWED_CLIENT_IDS)
class TaskTimerApi(remote.Service):
  """TaskTimer API v1."""

  @staticmethod
  def get_user():
    current_user = endpoints.get_current_user()
    if current_user is None:
      raise endpoints.UnauthorizedException('Invalid token.')
    return current_user

  def get_user_ancestor(self):
    return self.get_user().user_id()

  @endpoints.method(Task, Task,
                    path='tasks', http_method='POST',
                    name='tasks.createTask')
  def create_task(self, request):
    user = self.get_user()
    db_task = one_task_to_another(models.Task, request,
        parent=self.get_user_ancestor())
    db_task.put()
    # db_task should have a key now.
    return one_task_to_another(Task, db_task)

  @endpoints.method(message_types.VoidMessage, TaskCollection,
                    path='tasks', http_method='GET',
                    name='tasks.listTasks')
  def tasks_list(self, unused_request):
    user = self.get_user()
    tasks = []
    for task in models.Task.query(
        ancestor=ndb.Key(models.User, self.get_user_ancestor())).order(-models.Task.created).iter():
      tasks.append(one_task_to_another(Task, task))
    return TaskCollection(items=tasks)

  TASK_POST_RESOURCE = endpoints.ResourceContainer(
      Task,
      req_task_id=messages.IntegerField(2, variant=messages.Variant.INT64,
        required=True))
  @endpoints.method(TASK_POST_RESOURCE, Task,
                    path='tasks/{req_task_id}', http_method='POST',
                    name='tasks.updateTask')
  def update_task(self, request):
    user = self.get_user()
    db_task = models.Task.get_by_id(request.req_task_id,
        parent=ndb.Key(models.Task, self.get_user_ancestor()))
    if not db_task:
      raise endpoints.NotFoundException('task %s not found' %
          (request.req_task_id,))
    else:
      update_db_task(db_task, request)
    db_task.put()
    return one_task_to_another(Task, db_task)

  TASK_GET_RESOURCE = endpoints.ResourceContainer(
      message_types.VoidMessage,
      task_id=messages.IntegerField(2, variant=messages.Variant.INT64,
        required=True))
  @endpoints.method(TASK_GET_RESOURCE, Task,
                    path='tasks/{task_id}', http_method='GET',
                    name='tasks.getTask')
  def get_task(self, request):
    user = self.get_user()
    db_task = models.Task.get_by_id(request.task_id,
        parent=self.get_user_ancestor())
    if not db_task:
      raise endpoints.NotFoundException('task %s not found' %
          (request.task_id,))
    else:
      return one_task_to_another(Task, db_task)

  @endpoints.method(User, message_types.VoidMessage,
                    path='user', http_method='POST',
                    name='users.updateUser')
  def update_user(self, request):
    user = self.get_user()

    models.User.create_or_update(str(user.user_id()), user.email(),
        request.wants_email)

    return message_types.VoidMessage()

app = endpoints.api_server([TaskTimerApi])
