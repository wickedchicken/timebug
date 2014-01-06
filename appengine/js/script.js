function customInit(){
  window.init();
}

var myApp = angular.module('timetracker',[]);
 
myApp.controller('trackcontroller', function($scope, $timeout, $window, $location, $http) {
  $scope.estimate = 10.0
  $scope.calced_estimates = {};
  $scope.calced_day_estimates = {};
  $scope.estimates = '';
  $scope.estimate_text = '';
  $scope.username = 'unauthorized';
  $scope.backend_ready = false;
  $scope.is_authorized = false;
  $scope.buttontext = 'start';
  $scope.start = null;
  $scope.time = 0.0;
  $scope.elapsed = 0.0;
  $scope.actual_mins = 0.0;
  $scope.actual_secs = 0.0;
  $scope.tasks = [];
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
    gapi.client.load('tasktimer', 'v1', function() {
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

  $scope.drawChart = function(){
    var header = [['Estimate', 'Actual']];

    var dat_norm = _.map($scope.concattasks(),
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
      return [Number(key)].concat(stats(x));
    });

    $scope.calced_estimates = _.groupBy(group_stats, function(x) { return String(x[0]); });

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

    var days_between = function(a, b){
      return Math.round(Math.abs(
            (a.getTime() - b.getTime())/(24*60*60*1000)));
    }

    var days_since_epoch = function(a){
      var epoch = new Date(70,1,1);
      return days_between(a, epoch);
    }

    var dat_abs_day = _.groupBy(_.map($scope.concattasks(),
          function(x){return [days_since_epoch(x.date),
            $scope.days[x.date.getDay()], x.actual / 60.0]
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
    var group_stats = _.map(grouped, function(x, key) {
      return [key].concat(stats(x));
    });

    var data = new google.visualization.DataTable();
    data.addColumn('string', 'day');
    data.addColumn('number', 'total minutes');
    data.addColumn({id:'i0', type:'number', role:'interval'});
    data.addColumn({id:'i1', type:'number', role:'interval'});
    data.addColumn({id:'i2', type:'number', role:'interval'});
    data.addColumn({id:'i3', type:'number', role:'interval'});
    data.addColumn({id:'i0', type:'number', role:'interval'});


    data.addRows(_.map($scope.days, function(x) {
      var data = _.find(group_stats, function(y){ return y[0] == x;});
      if (data !== undefined){
        return data;
      } else {
        return [x, null, null, null, null, null, null];
      }
    }));

    var oldest_group = _.groupBy($scope.concattasks(), function(x) { return x.date.getDay(); });

    var now = new Date();
    var days_recorded = {}
    _.map(oldest_group, function(tasks, k){
      var old = _.first(_.sortBy(tasks, function(x) { return x.date; }));
      days_recorded[$scope.days[tasks[0].date.getDay()]] = 1 + days_between(old.date, now);
    });

    $scope.calced_day_estimates = _.groupBy(group_stats, function(x) { return x[0]; });

    // The intervals data as narrow lines (useful for showing raw source
    // data)
    var options = {
        title: 'Per day throughput',
        curveType: 'function',
        series: [{'color': '#CC66FF'}],
        intervals: { style: 'bars' },
        lineWidth: 0,
        legend: 'none',
        width: 400,
        height: 300,
        intervals: { 'lineWidth': 1.5, 'barWidth': 0.3 },
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
      if (resp.error){
        console.log(resp);
      } else {
        $scope.$apply(function(){
          if ('items' in resp) {
            $scope.tasks = resp.items;
            _.each($scope.tasks, function (x) { x.date = new Date(x.modified); });
            var task_ids = _.map($scope.tasks, function(x) {
              return String(x.task_id);
            });
            $scope.posted_tasks = _.filter($scope.posted_tasks, function (x) {
              return !_.contains(task_ids, x);
            });
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
          startday = (startday + 1) % $scope.days.length;
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

  $scope.submit = function(){
    if($scope.timer_running){
      $scope.toggleTimer();
    }
    if($scope.time > 0.0){
      gapi.client.tasktimer.tasks.createTask(
          {'name':$scope.name,
           'estimate':$scope.estimate * 60,
           'actual':$scope.time/1000,
           'finished':true
          }).execute(function(resp) {
            if (resp.error){
              consoel.log(resp);
            } else{
              resp.date = new Date(resp.modified);
              $scope.posted_tasks[String(resp.task_id)] = resp;
              $scope.$apply(function(){
                $scope.time = 0.0;
                $scope.actual_mins = 0.0;
                $scope.actual_secs = 0.0;
                $scope.estimated = 0.0;
                $scope.name = '';
                $scope.get_item_list();
              });
            }
          });
    }
  };
});
