"""Tasktimer API implemented using Google Cloud Endpoints."""

import json
import os
import sys

import endpoints
import logging
from protorpc import messages
from protorpc import message_types
from protorpc import remote

import models

from google.appengine.api import memcache
from google.appengine.ext import ndb

SCRIPT_PATH = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(
  SCRIPT_PATH, 'third_party', 'gcs-client-python', 'src'))

import cloudstorage

BUCKET='/task-data'

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
  for i in ['estimate', 'actual', 'finished', 'modified', 'name']:
    if i in (x.name for x in request_task.all_fields()):
      setattr(db_task, i, getattr(request_task, i))

def one_task_to_another(target_class, other_task, parent=None):
  if parent and target_class != Task:
    # database
    parent_key=ndb.Key(models.User, parent)

    target = target_class(
        parent=parent_key,
        estimate=other_task.estimate,
        actual=other_task.actual,
        finished=other_task.finished,
        modified=other_task.modified,
        name=other_task.name)
    logging.info(str(target))
  else:
    # protobuf
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

class TaskOrder(messages.Message):
  """Ordering of tasks."""
  ordering = messages.IntegerField(1, repeated=True)

class TaskCollection(messages.Message):
  """Collection of tasks."""
  items = messages.MessageField(Task, 1, repeated=True)

ALLOWED_CLIENT_IDS = [
    '471586205082.apps.googleusercontent.com',
    endpoints.API_EXPLORER_CLIENT_ID
]

@endpoints.api(name='tasktimer', version='v4',
    allowed_client_ids=ALLOWED_CLIENT_IDS)
class TaskTimerApi(remote.Service):
  """TaskTimer API v4."""

  @staticmethod
  def get_user():
    current_user = endpoints.get_current_user()
    if current_user is None:
      raise endpoints.UnauthorizedException('Invalid token.')
    return current_user

  def get_user_ancestor(self):
    return str(self.get_user().user_id() or self.get_user().email())

  @endpoints.method(Task, Task,
                    path='tasks', http_method='POST',
                    name='tasks.createOrUpdateTask')
  def create_or_update_task(self, request):
    user = self.get_user()
    if hasattr(request, 'task_id') and request.task_id:
      db_task = ndb.Key('User', self.get_user_ancestor(),
          'Task', request.task_id).get()
      if not db_task:
        raise endpoints.NotFoundException('task \'%s\' not found' %
            (request.task_id,))
      else:
        update_db_task(db_task, request)
    else:
      db_task = one_task_to_another(models.Task, request,
          parent=self.get_user_ancestor())

    # db_task should have a key now.
    db_task.put()
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

  TASK_GET_RESOURCE = endpoints.ResourceContainer(
      message_types.VoidMessage,
      task_id=messages.IntegerField(2, variant=messages.Variant.INT64,
        required=True))
  @endpoints.method(TASK_GET_RESOURCE, Task,
                    path='tasks/{task_id}', http_method='GET',
                    name='tasks.getTask')
  def get_task(self, request):
    user = self.get_user()
    db_task = ndb.Key('User', self.get_user_ancestor(),
        'Task', task_id).get()
    if not db_task:
      raise endpoints.NotFoundException('task %s not found' %
          (request.task_id,))
    else:
      return one_task_to_another(Task, db_task)

  TASK_DELETE_RESOURCE = endpoints.ResourceContainer(
      message_types.VoidMessage,
      task_id=messages.IntegerField(2, variant=messages.Variant.INT64,
        required=True))
  @endpoints.method(TASK_DELETE_RESOURCE, message_types.VoidMessage,
                    path='tasks/{task_id}', http_method='DELETE',
                    name='tasks.deleteTask')
  def delete_task(self, request):
    user = self.get_user()
    ndb.Key('User', self.get_user_ancestor(),
        'Task', request.task_id).delete()
    return message_types.VoidMessage()

  @endpoints.method(User, message_types.VoidMessage,
                    path='user', http_method='POST',
                    name='users.updateUser')
  def update_user(self, request):
    user = self.get_user()

    user_id = user.user_id() or user.email()

    models.User.create_or_update(str(user_id), user.email(),
        request.wants_email)

    return message_types.VoidMessage()

  @endpoints.method(message_types.VoidMessage, TaskOrder,
                    path='task_order', http_method='GET',
                    name='tasks.getTaskOrder')
  def get_task_order(self, request):
    user = self.get_user_ancestor()
    memcache_key = '%s:task_order' % user
    cached_data = memcache.get(memcache_key)
    if cached_data is not None:
      l = cached_data
    else:
      filename = '%s/%s/task_order' % (BUCKET, user)
      try:
        logging.info('loading file %s', filename)
        with cloudstorage.open(filename) as f:
          logging.debug('file %s loaded', filename)
          l = json.load(f)
      except cloudstorage.errors.NotFoundError:
        logging.debug('file %s not found`', filename)
        l = {'ordering': []}

      if not memcache.set(memcache_key, l):
        logging.error('Memcache set failed.')

    return TaskOrder(ordering=l['ordering'])

  @endpoints.method(TaskOrder, message_types.VoidMessage,
                    path='task_order', http_method='POST',
                    name='tasks.setTaskOrder')
  def set_task_order(self, request):
    user = self.get_user_ancestor()
    memcache_key = '%s:task_order' % user
    filename = '%s/%s/task_order' % (BUCKET, user)
    l = request.ordering
    with cloudstorage.open(filename, mode='w',
        content_type='application/json') as f:
      payload = {'ordering': list(l)}
      json.dump(payload, f)
      if not memcache.set(memcache_key, payload):
        logging.error('Memcache set failed.')

    return message_types.VoidMessage()


app = endpoints.api_server([TaskTimerApi])
