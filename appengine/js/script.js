function customInit(){
  window.init();
}

var myApp = angular.module('timetracker',[]);
 
myApp.controller('trackcontroller', function($scope, $timeout, $window, $location, $http) {
  $scope.estimate = 10.0
  $scope.realestimate = 10.0;
  $scope.realestimate_class = "text-default";
  $scope.calced_estimates = {};
  $scope.calced_day_estimates = {};
  $scope.estimates = '';
  $scope.estimate_text = '';
  $scope.username = 'unauthorized';
  $scope.backend_ready = false;
  $scope.is_authorized = false;
  $scope.buttontext = 'start';
  $scope.new_or_add_text = 'add';
  $scope.delete_or_clear_text = 'clear';
  $scope.start = null;
  $scope.time = 0.0;
  $scope.task_id = null;
  $scope.elapsed = 0.0;
  $scope.actual_mins = 0.0;
  $scope.actual_secs = 0.0;
  $scope.tasks = [];
  $scope.order = [];
  $scope.order_initialized = false;
  $scope.are_unfinished = false;
  $scope.days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  $scope.posted_tasks = {};
  $window.init = function() {
    $scope.handleClientLoad();
  };

  $scope.clientId = '471586205082.apps.googleusercontent.com';
  $scope.apiscopes = ['https://www.googleapis.com/auth/userinfo.email'];
  $scope.handleClientLoad = function() {
    gapi.client.load('oauth2', 'v2', function() {
      $scope.$apply($scope.on_api_load)
    });
    gapi.client.load('tasktimer', 'v4', function() {
      $scope.$apply($scope.on_api_load)
    }, '/_ah/api');
    $scope.load_chart_api();
  }

  $scope.checkAuth = function() {
    gapi.auth.authorize({client_id: $scope.clientId, scope: $scope.apiscopes,
      immediate: true}, $scope.handleAuthResult($scope.do_auth));
  }

  $scope.apis_to_load = 3;
  $scope.on_api_load = function(){
    --$scope.apis_to_load;
    if ($scope.apis_to_load == 0) {
      $scope.checkAuth();
    }
  }

  $scope.concattasks = function () {
    return $scope.tasks.concat(_.values($scope.posted_tasks));
  }

  $scope.unfinished = function() {
    return _.filter($scope.concattasks(), function(task){return !task.finished;});
  }

  $scope.unfinished_sorted = function() {
    $scope.get_task_order();

    // inefficient
    return _.sortBy($scope.unfinished(), function(x) {
      return _.indexOf($scope.order, x.task_id);
    });
  }

  $scope.calc_unfinished = function(){
    $scope.are_unfinished = Boolean($scope.unfinished().length);
  }

  $scope.finished = function() {
    return _.filter($scope.concattasks(), function(task){return task.finished;});
  }

  $scope.toggle_and_submit = function() {
    $scope.submit(false, false, true, true);
    $scope.toggleTimer();
  }

  $scope.fill_in_order = function() {
    var existing_tasks = _.pluck($scope.unfinished(), 'task_id');
    $scope.order = _.filter($scope.order, function(x) {
      return _.contains(existing_tasks, x);
    });

    var new_tasks = _.map(_.filter($scope.unfinished(), function(x) {
      return !(_.contains($scope.order, x.task_id));
    }), function(x) { return x.task_id; });
    if (new_tasks.length > 0) {
      $scope.order = $scope.order.concat(new_tasks);
      $scope.set_task_order_smooth();
    }
  }

  $scope.get_task_order = function() {
    if ($scope.is_authorized) {
      if (!$scope.order_initialized) {
        gapi.client.tasktimer.tasks.getTaskOrder().execute(function(resp){
          if (!resp || resp.error){
            if (!resp){
              console.log('error contacting server!');
            } else {
              console.log(resp);
            }
          } else {
            $scope.$apply(function(){
              $scope.order_initialized = true;
              if ('ordering' in resp) {
                $scope.order = resp.ordering;
                $scope.fill_in_order();
              }
            });
          }
        });
      } else {
        $scope.fill_in_order();
      }
    }
  }

  $scope.set_task_order = function(){
    gapi.client.tasktimer.tasks.setTaskOrder({'ordering': $scope.order}).execute(function(resp){
      if (!resp || resp.error){
        if (!resp){
          console.log('error contacting server!');
        } else {
          console.log(resp);
        }
      }
    });
  }

  $scope.set_task_order_smooth = _.debounce($scope.set_task_order, 3000);

  $scope.moveup = function(task_id) {
    $scope.get_task_order();
    var index = _.indexOf($scope.order, task_id);
    if (index > 0) {
      var temp = $scope.order[index-1];
      $scope.order[index-1] = task_id;
      $scope.order[index] = temp;
      $scope.do_binpack();
      $scope.set_task_order_smooth();
    }
  }

  $scope.movedown = function(task_id) {
    $scope.get_task_order();
    var index = _.indexOf($scope.order, task_id);
    if (index < (_.size($scope.order) - 1)) {
      var temp = $scope.order[index+1];
      $scope.order[index+1] = task_id;
      $scope.order[index] = temp;
      $scope.do_binpack();
      $scope.set_task_order_smooth();
    }
  }

  $scope.get_fill_for_date = function(date){
    var fill_days = _.filter($scope.finished(), function(x) {
      var m = moment(x['modified'], 'YYYY-MM-DDTHH:mm Z');
      return (date.year() === m.year()) && (date.dayOfYear() === m.dayOfYear());
    });
    var dow = date.format('ddd')
    if (fill_days.length == 0) {
      return [dow, null];
    }
    var fill = _.reduce(
        fill_days, function(x, y){ return x + y['actual']; }, 0.0);

    return [dow, fill];
  }

  $scope.do_binpack = function(){
    var get_tuple = function(date){
      if (date.format('ddd') in $scope.calced_day_estimates) {
        var cap = _.last(
            $scope.calced_day_estimates[date.format('ddd')][0]);
      } else {
        var cap = 0.0;
      }

      return {'date': date,
              'count': 0.0,
              'capacity': cap * 60};
    }

    if (_.keys($scope.calced_day_estimates).length < 1){
      _.each($scope.unfinished(), function(x) {
        x['day_estimate'] = null;
      });
      return;
    }

    var days = [];
    var today = moment();
    days.push(get_tuple(today));
    var fill = $scope.get_fill_for_date(today)[1];
    if (fill != null) {
      days[0]['count'] = fill;
    } else {
      days[0]['count'] = 0.0;
    }

    var add_new_day = function(){
      var date = moment(_.last(days)['date']);
      date.add('days', 1);
      days.push(get_tuple(date));
    }

    var max_capacity = _.max(_.map(_.values($scope.calced_day_estimates),
          function(x) {
            return _.last(x[0]);
          })) * 60;

    var capacity_left = function(x) {
      return x['capacity'] - x['count'];
    }

    // first-fit algorithm
    _.each($scope.unfinished_sorted(), function(x){
      if (x['realestimate'] > max_capacity){
        x['day_estimate'] = null;
      } else {
        var idx = 0;
        while(capacity_left(days[idx]) < x['realestimate']){
          idx = idx + 1;
          if (idx > (days.length - 1)) {
            add_new_day();
          }
        }
        x['day_estimate'] = days[idx]['date'];
        days[idx]['count'] = days[idx]['count'] + x['realestimate'];
      }
    });
  }

  $scope.drawChart = function(){
    var header = [['Estimate', 'Actual']];

    var dat_norm = _.map($scope.finished(),
                    function(x){return [x.estimate / 60.0, (x.actual - x.estimate) / 60.0]});

    var default_append = function(obj, key, value){
      if (key in obj){
        obj[key].push(value);
      } else {
        obj[key] = [value];
      }
      return obj;
    };

    var grouped = _.reduce(dat_norm, function(x, y) {return default_append(x, y[0], y[1])}, {});

    var recursive_split = function(amount, low, high){
      var diff = high - low;
      var neg = low + Math.floor(diff / 2);
      var pos = low + Math.floor(diff / 2) + (diff % 2);
      if (amount > 0) {
        return recursive_split(amount - 1, low, neg).concat(
            recursive_split(0, neg, pos)).concat(
            recursive_split(amount -1, pos, high));
      } else {
        return [[neg, pos]];
      }
    };

    var stats = function(arr){
      if (arr.length < 1){
        return [];
      }

      var avg = _.reduce(arr, function(x, y) { return x + y }, 0.0) / arr.length;
      var max = _.max(arr);
      var min = _.min(arr);
      var sorted = _.sortBy(arr, function(a,b){return a-b});
      // recursive_split(1, ...) gives us quartiles.
      var quartiles = _.map(
          recursive_split(1, 0, arr.length - 1),
          function(x) {
            return (sorted[x[0]] + sorted[x[1]]) / 2.0;
          });

      // Regardless of how many divisions we specify in quartiles, make sure
      // upper/lower 25% are first and last. This way visualization will put a
      // line through them signifying middle 50%.
      var quartiles_idx = recursive_split(1, 0, quartiles.length - 1);
      var quartile_location = [_.first(_.first(quartiles_idx)),
                               _.last(_.last(quartiles_idx))];
      var low50 = quartiles.splice(quartile_location[0], 1)[0];
      var top50 = quartiles.splice(quartile_location[1] - 1, 1)[0];

      return [avg, low50, min, max].concat(quartiles).concat([top50]);
    }

    var group_stats = _.map(grouped, function(x, key) {
      return [Number(key)].concat(_.map(stats(x), Math.floor));
    });

    $scope.calced_estimates = _.groupBy(group_stats, function(x) { return String(x[0]); });

    $scope.update_estimate();
    _.each($scope.concattasks(), function(task){
      task['realestimate'] = $scope.calculate_realestimate(task.estimate / 60) * 60;
    });

    var snap_to = 5;
    if (group_stats.length > 0) {
      var max_estimate = _.max(_.map(_.keys(grouped), Number));
    } else {
      var max_estimate = 0;
    }

    var max_chart_value = max_estimate + (5 - (max_estimate % 5));

    var data = new google.visualization.DataTable();
    data.addColumn('number', 'estimate');
    data.addColumn('number', 'difference');
    data.addColumn({id:'i0', type:'number', role:'interval'});
    data.addColumn({id:'i1', type:'number', role:'interval'});
    data.addColumn({id:'i2', type:'number', role:'interval'});
    data.addColumn({id:'i3', type:'number', role:'interval'});
    data.addColumn({id:'i0', type:'number', role:'interval'});

    data.addRows(_.sortBy(group_stats, function(a){return a[0];}));

    // The intervals data as narrow lines (useful for showing raw source
    // data)
    var options = {
        title: 'Prediction Over/under estimate',
        curveType: 'function',
        series: [{'color': '#D9544C'}],
        intervals: { style: 'bars' },
        legend: 'none',
        width: 400,
        height: 300,
        hAxis: {baseline: 0,
          viewWindowMode: 'explicit',
          viewWindow: {
            max: max_chart_value
          }
        },
        intervals: { 'lineWidth': 1.5, 'barWidth': 0.3 },
    };

    var chart_lines = new google.visualization.LineChart(document.getElementById('chart_div'));

    // Set chart options
    chart_lines.draw(data, options);

    var data_norm = google.visualization.arrayToDataTable(header.concat(dat_norm));

    // Set chart options
    var options_norm = {'title':'Prediction vs Reality Difference',
      hAxis: {baseline: 0,
        legend: 'none',
        viewWindowMode: 'explicit',
        viewWindow: {
          max: max_chart_value
        }
      },
      width:400,
      height:300};

    // Instantiate and draw our chart, passing in some options.
    var chart_norm = new google.visualization.ScatterChart(document.getElementById('chart_div2'));
    chart_norm.draw(data_norm, options_norm);

    var dat_abs_day = _.groupBy(_.map($scope.finished(),
          function(x){
            return [x.date.format('YYYY-MM-DD'),
                    x.date.format('ddd'), x.actual / 60.0];
          }),
        function(x){
          return x[0];
        });
    var dat_abs = [];
    _.each(dat_abs_day, function(v, k){
      dat_abs.push([v[0][1], _.reduce(_.map(v, function(x){ return x[2];}),
          function(x,y){ return x + y;}, 0.0)]);
    });
    var grouped = _.reduce(dat_abs, function(x, y) {return default_append(x, y[0], y[1])}, {});
    var fill = $scope.get_fill_for_date(moment());
    var group_stats = _.map(grouped, function(x, key) {
      var stat = _.map(stats(x), Math.floor);
      if (key === fill[0]){
        var day_fill = Math.floor(fill[1] / 60);
      } else {
        var day_fill = null;
      }
      return [key].concat(stat.slice(0, -1)).concat([day_fill]).concat(stat.slice(-1))
    });

    var data = new google.visualization.DataTable();
    data.addColumn('string', 'day');
    data.addColumn('number', 'total minutes');
    data.addColumn({id:'i0', type:'number', role:'interval'});
    data.addColumn({id:'i1', type:'number', role:'interval'});
    data.addColumn({id:'i2', type:'number', role:'interval'});
    data.addColumn({id:'i3', type:'number', role:'interval'});
    data.addColumn({id:'today', type:'number', role:'interval'});
    data.addColumn({id:'i0', type:'number', role:'interval'});


    data.addRows(_.map($scope.days, function(x) {
      var data = _.find(group_stats, function(y){ return y[0] == x;});
      if (data !== undefined){
        return data;
      } else {
        return [x, null, null, null, null, null, null, null];
      }
    }));

    $scope.calced_day_estimates = _.groupBy(group_stats, function(x) { return x[0]; });
    $scope.do_binpack();

    // The intervals data as narrow lines (useful for showing raw source
    // data)
    var options = {
        title: 'Per day throughput',
        curveType: 'function',
        series: [{'color': '#CC66FF'}],
        lineWidth: 0,
        legend: 'none',
        width: 400,
        height: 300,
        intervals: {'style': 'bars',  'lineWidth': 1.5, 'barWidth': 0.3 },
        interval: {today: {'color': '#F1CA3A', 'shortBarWidth': 1.2}}
    };

    var chart_lines = new google.visualization.LineChart(document.getElementById('chart_div3'));

    // Set chart options
    chart_lines.draw(data, options);
    $scope.recalc_estimates();
  }

  $scope.load_chart_api = function(){
    google.load('visualization', '1.0', {
      'packages':['corechart'],
      'callback':$scope.on_api_load
    });
  }

  $scope.do_auth = function(){
    $scope.backend_ready = true;
    var request = gapi.client.oauth2.userinfo.get();
    request.execute($scope.getEmailCallback);
  }

  $scope.handleAuthResult = function(callback){
    return function(authResult) {
      if (authResult && !authResult.error) {
        callback();
      } else {
        $scope.$apply(function(){
          $scope.is_authorized = false;
        })
      }
    }
  }

  $scope.handleAuthClick = function(event) {
    gapi.auth.authorize({client_id: $scope.clientId, scope: $scope.apiscopes,
      immediate: false}, $scope.handleAuthResult($scope.do_auth));
  }

  $scope.logout = function(event) {
    var logout_url = 'https://accounts.google.com/o/oauth2/revoke?token=' + gapi.auth.getToken().access_token;
    $http.jsonp(logout_url).
      success(function(data, status, headers, config) {
        gapi.auth.setToken(null);
        $scope.is_authorized = false;
        $scope.username = false;
      }).
      error(function(data, status, headers, config) {
        // Google returns HTML instead of json, which is technically an error.
        gapi.auth.setToken(null);
        $scope.is_authorized = false;
        $scope.username = false;
      });
  }

  $scope.get_item_list = function(){
    gapi.client.tasktimer.tasks.listTasks().execute(function(resp){
      if (!resp || resp.error){
        if (!resp){
          console.log('error contacting server!');
        } else {
          console.log(resp);
        }
      } else {
        $scope.$apply(function(){
          if ('items' in resp) {
            $scope.tasks = resp.items;
            _.each($scope.tasks, function (x) { x.date = moment(x.modified,
                'YYYY-MM-DDTHH:mm Z'); });
            var task_ids = _.map($scope.tasks, function(x) {
              return String(x.task_id);
            });
            $scope.posted_tasks = _.filter($scope.posted_tasks, function (x) {
              return !_.contains(task_ids, x);
            });
            $scope.get_task_order();
            $scope.calc_unfinished();
            $scope.drawChart();
          }
        });
      }
    });
  }

  $scope.getEmailCallback = function(obj){
    $scope.$apply(function(){
      $scope.username = obj['email'];
      $scope.is_authorized = true;
      gapi.client.tasktimer.users.updateUser({
        'last_seen_email':obj['email']
      }).execute(function(resp) {
        if (resp.error){
          console.log(resp);
        }
      });
    })
    $scope.get_item_list();
  }

  $scope.recalc_estimates = function(){
    var inputs = _.filter(
        _.map($scope.estimates.replace(/ /g,'').split(','), Number),
        Boolean);
    if (inputs.length > 0) {
      var estimates = _.map(inputs, function(x){
        if (String(x) in $scope.calced_estimates){
          var data = $scope.calced_estimates[String(x)][0];
          // botton 50 and top 50
          return [data[2], _.last(data)];
        } else {
          // no data, just return the original estimate
          return [x, x];
        }
      });
      var total_proj = _.reduce(estimates, function(x,y) {
        return [x[0] + y[0], x[1] + y[1]];
      }, [0,0]);

      var days_until = function(left, upper){
        var total_days = 1;
        var startday = (new Date).getDay();
        if (_.keys($scope.calced_day_estimates).length < 1){
          return 0; // avoid inf loop
        }
        while (left > 0){
          startday = (startday + 1) % $scope.days.length;
          if ($scope.days[startday] in $scope.calced_day_estimates) {
            var day_data = $scope.calced_day_estimates[$scope.days[startday]][0];
            if (upper){
              left -= _.last(day_data);
            } else {
              left -= day_data[2];
            }
          } // otherwise no day data, skip to next day
          if (left > 0) {
            total_days += 1;
          }
        }
        return total_days;
      }
      var low_est = String(Math.round(total_proj[0]));
      var hi_est = String(Math.round(total_proj[1]));
      var low_days = String(days_until(total_proj[0], true));
      var hi_days = String(days_until(total_proj[1], false));
      $scope.estimate_text = ('estimate: ' + low_est + '/' + hi_est + 'm or ' +
        low_days + '/' + hi_days + 'd');
    } else {
      $scope.estimate_text = '';
    }
  }

  $scope.update_actual = function(){
    $scope.elapsed = (($scope.actual_mins * 60.0) + $scope.actual_secs) * 1000
    if ($scope.start != null){
      var newtime = new Date().getTime();
      $scope.time = $scope.elapsed - Math.floor(newtime - $scope.start)
    } else {
      $scope.time = $scope.elapsed
    }
  }

  $scope.calculate_realestimate = function(estimate){
      var estimate_key = String(Math.floor(estimate));
      if (estimate_key in $scope.calced_estimates){
        return estimate + (_.last($scope.calced_estimates[estimate_key][0]));
      } else {
        return estimate;
      }
  }

  $scope.update_estimate = function(){
    $scope.realestimate = $scope.calculate_realestimate($scope.estimate);
    if ($scope.realestimate > 60) {
      $scope.realestimate_class = "text-error";
    } else if ($scope.realestimate > 30) {
      $scope.realestimate_class = "text-warning";
    } else {
      $scope.realestimate_class = "text-default";
    }
  }

  $scope.onTimeout = function(){
    var newtime = new Date().getTime();
    $scope.elapsed = Math.floor(newtime - $scope.start) + $scope.time;

    var secs_elapsed = $scope.elapsed / 1000;
    $scope.actual_mins = Math.floor(secs_elapsed / 60);
    $scope.actual_secs = Math.floor(secs_elapsed % 60);

    $scope.mytimeout = $timeout($scope.onTimeout, 500);
  }

  $scope.timer_running = false
  $scope.toggleTimer = function(){
    if($scope.timer_running){
      $scope.time += new Date().getTime() - $scope.start;
      $scope.start = null;
      $scope.timer_running = false;
      $scope.buttontext = 'start'
      $timeout.cancel($scope.mytimeout);
    } else {
      $scope.start = new Date().getTime(),
      $scope.timer_running = true;
      $scope.buttontext = 'pause';
      $scope.mytimeout = $timeout($scope.onTimeout,500);
    }
  };

  $scope.delete_task = function() {
    if ($scope.task_id){
      gapi.client.tasktimer.tasks.deleteTask({'task_id': $scope.task_id}).execute(
          function(resp) {
            if (!resp || resp.error){
              if (!resp){
                console.log('error contacting server!');
              } else {
                console.log(resp);
              }
            } else{
              console.log('deleted ' + String($scope.task_id));
              $scope.blank();
              $scope.get_item_list();
            }
          });
    } else {
      $scope.blank();
    }
  }

  $scope.set_task_id = function(task_id){
    $scope.task_id = task_id;
    if ($scope.task_id){
      $scope.new_or_add_text = 'new';
      $scope.delete_or_clear_text = 'delete';
    } else {
      $scope.new_or_add_text = 'add';
      $scope.delete_or_clear_text = 'clear';
    }
  }

  $scope.new_or_add = function(){
    if ($scope.task_id){
      $scope.submit($scope.done, false, false, false);
      $scope.blank();
    } else {
      $scope.submit(false, false, true, true);
    }
  }

  $scope.switch_to = function(task_id){
    task = _.find($scope.concattasks(), function(x){
      return x.task_id == String(task_id)});
    if (!task) {
      console.log('error! can\'t find task:' + String(task_id));
      $scope.blank();
      return;
    }
    if ($scope.timer_running) {
      $scope.toggleTimer();
      $scope.submit(false, false);
    }
    $scope.set_task_id(task.task_id);
    $scope.time = task.actual;
    $scope.estimate = Math.floor(task.estimate / 60);
    $scope.name = task.name;
    $scope.actual_mins = Math.floor(task.actual / 60);
    $scope.actual_secs = Math.floor(task.actual % 60);
  }

  $scope.blank = function(){
    $scope.set_task_id(null);
    $scope.time = 0.0;
    $scope.actual_mins = 0.0;
    $scope.actual_secs = 0.0;
    $scope.estimated = 0.0;
    $scope.name = '';
  }

  $scope.submit = function(done, switch_to, keep_timer, switch_task){
    if($scope.timer_running && !keep_timer){
      $scope.toggleTimer();
    }
    if(!done || $scope.time > 0.0){
      mytask = {'name':$scope.name,
        'estimate':$scope.estimate * 60,
        'actual':$scope.time/1000,
        'finished':done,
      }
      if ($scope.task_id != undefined){
        mytask['task_id'] = Number($scope.task_id);
      }
      gapi.client.tasktimer.tasks.createOrUpdateTask(mytask).execute(
          function(resp) {
            if (resp.error){
              console.log(resp);
            } else{
              resp.date = moment(resp.modified, 'YYYY-MM-DDTHH:mm Z');
              if (!_.contains(_.pluck($scope.concattasks(), 'task_id'),
                String(resp.task_id))){
                $scope.posted_tasks[String(resp.task_id)] = resp;
              }
              if (done){
                $scope.$apply(function(){
                  $scope.blank();
                });
              } else {
                if (switch_task) {
                  $scope.set_task_id(resp.task_id);
                }
                if (switch_to){
                  $scope.$apply(function(){
                    $scope.switch_to(resp.task_id);
                  });
                }
              }
              $scope.$apply(function(){
                $scope.get_item_list();
              });
            }
          });
    }
  };
});
