const coap = require('coap');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { buildRobotTD, buildTDDirectory } = require('./wot/td-generator');

const COAP_PORT = 5683;
const HTTP_PORT = 3000;
const TASK_DURATION_SECONDS = 30;
const BATTERY_NOMINAL_VOLTAGE = 14.4;

const app = express();
app.use(cors());
app.use(express.json());

const robots = {
  r1: {
    id: 'r1',
    name: 'RoboVac Alpha',
    status: 'cleaning',
    battery: 82,
    chargerEnabled: true,
    batteryCapacitymAh: 2400,
    batteryNominalVoltage: BATTERY_NOMINAL_VOLTAGE,
    tasks: [
      { id: 1, title: 'Clean kitchen', status: 'active', createdAt: 1, remainingSeconds: 20 },
      { id: 2, title: 'Clean hallway', status: 'pending', createdAt: 2, remainingSeconds: 30 }
    ]
  },
  r2: {
    id: 'r2',
    name: 'RoboVac Beta',
    status: 'cleaning',
    battery: 54,
    chargerEnabled: true,
    batteryCapacitymAh: 2600,
    batteryNominalVoltage: BATTERY_NOMINAL_VOLTAGE,
    tasks: [
      { id: 1, title: 'Clean bedroom', status: 'active', createdAt: 1, remainingSeconds: 20 }
    ]
  },
  r3: {
    id: 'r3',
    name: 'RoboVac Gamma',
    status: 'charging',
    battery: 19,
    chargerEnabled: true,
    batteryCapacitymAh: 3200,
    batteryNominalVoltage: BATTERY_NOMINAL_VOLTAGE,
    tasks: [
      { id: 1, title: 'Clean living room', status: 'done', createdAt: 1, remainingSeconds: 15 }
    ]
  }
};

const observers = new Map();

function getBatteryCapacityWh(robot) {
  return Number(((robot.batteryCapacitymAh * robot.batteryNominalVoltage) / 1000).toFixed(2));
}

function sendCoapJson(res, code, payload) {
  res.code = code;
  res.setOption('Content-Format', 'application/json');
  res.end(JSON.stringify(payload));
}

function parseUrl(url) {
  const parts = url.split('/').filter(Boolean);

  if (parts.length < 3 || parts[0] !== 'robots') {
    return {};
  }

  return {
    robotId: parts[1],
    resource: parts[2],
    taskId: parts[3] ? Number(parts[3]) : null
  };
}

function getSortedTasks(robot) {
  return [...robot.tasks].sort((a, b) => a.createdAt - b.createdAt);
}

function getActiveTask(robot) {
  return robot.tasks.find(task => task.status === 'active') || null;
}

function getOldestPendingTask(robot) {
  return getSortedTasks(robot).find(task => task.status === 'pending') || null;
}

function getCurrentTaskTitle(robot) {
  const activeTask = getActiveTask(robot);
  return activeTask ? activeTask.title : 'No active task';
}

function buildRobotStatusPayload(robot) {
  return {
    id: robot.id,
    name: robot.name,
    status: robot.status,
    battery: robot.battery,
    chargerEnabled: robot.chargerEnabled,
    batteryCapacitymAh: robot.batteryCapacitymAh,
    batteryNominalVoltage: robot.batteryNominalVoltage,
    batteryCapacityWh: getBatteryCapacityWh(robot),
    currentTask: getCurrentTaskTitle(robot)
  };
}

function notifyStatus(robotId) {
  const path = `/robots/${robotId}/status`;
  const subs = observers.get(path) || [];
  const robot = robots[robotId];
  const payload = JSON.stringify(buildRobotStatusPayload(robot));

  for (const res of subs) {
    res.write(payload);
  }
}

function reconcileRobotState(robot) {
  const activeTask = getActiveTask(robot);
  const nextTask = getOldestPendingTask(robot);

  if (robot.battery < 10) {
    if (activeTask) {
      activeTask.status = 'pending';
    }
    robot.status = 'charging';
    return;
  }

  if (activeTask) {
    robot.status = 'cleaning';
    return;
  }

  if (nextTask) {
    nextTask.status = 'active';
    robot.status = 'cleaning';
    return;
  }

  if (robot.battery >= 100) {
    robot.status = 'idle';
    return;
  }

  robot.status = 'charging';
}

function tickRobot(robot) {
  if (robot.status === 'cleaning') {
    const activeTask = getActiveTask(robot);

    if (!activeTask) {
      reconcileRobotState(robot);
      notifyStatus(robot.id);
      return;
    }

    robot.battery = Math.max(0, robot.battery - 1);
    activeTask.remainingSeconds = Math.max(0, activeTask.remainingSeconds - 1);

    if (robot.battery < 10) {
      activeTask.status = 'pending';
      robot.status = 'charging';
      notifyStatus(robot.id);
      return;
    }

    if (activeTask.remainingSeconds === 0) {
      activeTask.status = 'done';
      reconcileRobotState(robot);
      notifyStatus(robot.id);
      return;
    }

    notifyStatus(robot.id);
    return;
  }

  if (robot.status === 'charging') {
    if (robot.chargerEnabled && robot.battery < 100) {
      robot.battery = Math.min(100, robot.battery + 1);
    }

    reconcileRobotState(robot);
    notifyStatus(robot.id);
    return;
  }

  if (robot.status === 'idle') {
    const nextTask = getOldestPendingTask(robot);

    if (nextTask) {
      reconcileRobotState(robot);
      notifyStatus(robot.id);
    }

    return;
  }

  reconcileRobotState(robot);
  notifyStatus(robot.id);
}

setInterval(() => {
  Object.values(robots).forEach(tickRobot);
}, 1000);

function validateTaskStatus(value) {
  return ['pending', 'done'].includes(value);
}

const coapServer = coap.createServer((req, res) => {
  const { robotId, resource, taskId } = parseUrl(req.url);
  const robot = robots[robotId];

  if (!robot) {
    return sendCoapJson(res, '4.04', { error: 'Robot not found' });
  }

  const isObserve = req.headers && req.headers.Observe === 0;

  if (resource === 'status') {
    if (req.method !== 'GET') {
      return sendCoapJson(res, '4.05', { error: 'Method not allowed' });
    }

    const payload = buildRobotStatusPayload(robot);

    if (isObserve) {
      const key = req.url;
      const current = observers.get(key) || [];
      current.push(res);
      observers.set(key, current);

      res.setOption('Content-Format', 'application/json');
      res.setOption('Observe', 0);
      res.write(JSON.stringify(payload));
      return;
    }

    return sendCoapJson(res, '2.05', payload);
  }

  if (resource === 'tasks') {
    if (req.method === 'GET') {
      return sendCoapJson(res, '2.05', {
        robotId: robot.id,
        total: robot.tasks.length,
        tasks: getSortedTasks(robot),
        filler: 'x'.repeat(1500)
      });
    }

    if (req.method === 'POST') {
      try {
        const body = JSON.parse(req.payload.toString() || '{}');
        const title = String(body.title || '').trim();

        if (title === '') {
          return sendCoapJson(res, '4.00', { error: 'Task title required' });
        }

        const newId = robot.tasks.length ? Math.max(...robot.tasks.map(t => t.id)) + 1 : 1;

        const newTask = {
          id: newId,
          title,
          status: 'pending',
          createdAt: Date.now(),
          remainingSeconds: TASK_DURATION_SECONDS
        };

        robot.tasks.push(newTask);
        reconcileRobotState(robot);
        notifyStatus(robot.id);

        return sendCoapJson(res, '2.01', {
          message: 'Task created',
          task: newTask
        });
      } catch (e) {
        return sendCoapJson(res, '4.00', { error: 'Invalid JSON' });
      }
    }

    if (req.method === 'PUT') {
      if (!taskId) {
        return sendCoapJson(res, '4.00', { error: 'Task ID required' });
      }

      try {
        const body = JSON.parse(req.payload.toString() || '{}');
        const task = robot.tasks.find(t => t.id === taskId);

        if (!task) {
          return sendCoapJson(res, '4.04', { error: 'Task not found' });
        }

        if (body.title !== undefined) {
          const newTitle = String(body.title).trim();
          if (newTitle === '') {
            return sendCoapJson(res, '4.00', { error: 'Task title required' });
          }
          task.title = newTitle;
        }

        if (body.status !== undefined) {
          if (!validateTaskStatus(body.status)) {
            return sendCoapJson(res, '4.00', { error: 'Allowed statuses: pending, done' });
          }

          task.status = body.status;

          if (body.status === 'pending') {
            task.remainingSeconds = TASK_DURATION_SECONDS;
          }

          if (body.status === 'done') {
            task.remainingSeconds = 0;
          }
        }

        if (task.status === 'active') {
          return sendCoapJson(res, '4.00', { error: 'Active status is managed automatically' });
        }

        reconcileRobotState(robot);
        notifyStatus(robot.id);

        return sendCoapJson(res, '2.04', {
          message: 'Task updated',
          task
        });
      } catch (e) {
        return sendCoapJson(res, '4.00', { error: 'Invalid JSON' });
      }
    }

    if (req.method === 'DELETE') {
      if (!taskId) {
        return sendCoapJson(res, '4.00', { error: 'Task ID required' });
      }

      const index = robot.tasks.findIndex(t => t.id === taskId);

      if (index === -1) {
        return sendCoapJson(res, '4.04', { error: 'Task not found' });
      }

      const deleted = robot.tasks.splice(index, 1)[0];
      reconcileRobotState(robot);
      notifyStatus(robot.id);

      return sendCoapJson(res, '2.02', {
        message: 'Task deleted',
        task: deleted
      });
    }

    return sendCoapJson(res, '4.05', { error: 'Method not allowed' });
  }

  return sendCoapJson(res, '4.04', { error: 'Resource not found' });
});

coapServer.listen(COAP_PORT, () => {
  console.log(`CoAP server started on port ${COAP_PORT}`);
});

function mapCoapToHttp(code) {
  const map = {
    '2.01': 201,
    '2.02': 200,
    '2.04': 200,
    '2.05': 200,
    '4.00': 400,
    '4.04': 404,
    '4.05': 405
  };

  return map[code] || 500;
}

function coapRequest(method, pathname, body = null) {
  return new Promise((resolve, reject) => {
    const req = coap.request({
      hostname: 'localhost',
      port: COAP_PORT,
      pathname,
      method,
      confirmable: true
    });

    req.setOption('Accept', 'application/json');

    let finished = false;

    const timeoutId = setTimeout(() => {
      if (finished) return;
      finished = true;
      try {
        req.close();
      } catch (e) {
        reject(new Error('CoAP close error'));
        return;
      }
      reject(new Error('CoAP timeout'));
    }, 2000);

    req.on('response', (res) => {
      let data = '';

      res.on('data', chunk => {
        data += chunk.toString();
      });

      res.on('end', () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeoutId);

        try {
          resolve({
            httpStatus: mapCoapToHttp(res.code),
            data: JSON.parse(data || '{}')
          });
        } catch (e) {
          reject(new Error('Invalid JSON from CoAP'));
        }
      });
    });

    req.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

app.get('/api/wot/context', (req, res) => {
  const contextPath = path.join(__dirname, 'wot', 'wot-context.jsonld');

  try {
    const content = fs.readFileSync(contextPath, 'utf8');
    res.setHeader('Content-Type', 'application/ld+json');
    res.send(content);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load JSON-LD context' });
  }
});

app.get('/api/td/search', (req, res) => {
  const type = req.query.type;

  let result = Object.values(robots);

  if (type && type !== 'RobotVacuum') {
    result = [];
  }

  res.json({
    count: result.length,
    things: result.map(robot => ({
      id: robot.id,
      name: robot.name,
      td: `http://localhost:${HTTP_PORT}/api/td/${robot.id}`
    }))
  });
});

app.get('/api/td/:id', (req, res) => {
  const robot = robots[req.params.id];

  if (!robot) {
    return res.status(404).json({ error: 'Thing not found' });
  }

  const td = buildRobotTD(robot, `http://localhost:${HTTP_PORT}`);
  res.setHeader('Content-Type', 'application/td+json');
  res.json(td);
});

app.get('/api/td', (req, res) => {
  const directory = buildTDDirectory(Object.values(robots), `http://localhost:${HTTP_PORT}`);
  res.json(directory);
});

app.get('/api/robots', (req, res) => {
  const result = Object.values(robots).map(robot => ({
    id: robot.id,
    name: robot.name,
    status: robot.status,
    battery: robot.battery,
    chargerEnabled: robot.chargerEnabled,
    batteryCapacitymAh: robot.batteryCapacitymAh,
    batteryNominalVoltage: robot.batteryNominalVoltage,
    batteryCapacityWh: getBatteryCapacityWh(robot),
    currentTask: getCurrentTaskTitle(robot),
    tasksCount: robot.tasks.length
  }));

  res.json({ robots: result });
});

app.get('/api/robots/:id/status', async (req, res) => {
  try {
    const result = await coapRequest('GET', `/robots/${req.params.id}/status`);
    res.status(result.httpStatus).json(result.data);
  } catch (e) {
    res.status(504).json({ error: 'Gateway timeout', details: e.message });
  }
});

app.put('/api/robots/:id/charger', (req, res) => {
  const robot = robots[req.params.id];

  if (!robot) {
    return res.status(404).json({ error: 'Robot not found' });
  }

  if (typeof req.body.enabled !== 'boolean') {
    return res.status(400).json({ error: 'Field enabled must be boolean' });
  }

  robot.chargerEnabled = req.body.enabled;
  notifyStatus(robot.id);

  res.json({
    message: 'Charger state updated',
    id: robot.id,
    chargerEnabled: robot.chargerEnabled
  });
});

app.get('/api/robots/:id/tasks', async (req, res) => {
  try {
    const result = await coapRequest('GET', `/robots/${req.params.id}/tasks`);
    res.status(result.httpStatus).json(result.data);
  } catch (e) {
    res.status(504).json({ error: 'Gateway timeout', details: e.message });
  }
});

app.post('/api/robots/:id/tasks', async (req, res) => {
  try {
    const result = await coapRequest('POST', `/robots/${req.params.id}/tasks`, req.body);
    res.status(result.httpStatus).json(result.data);
  } catch (e) {
    res.status(504).json({ error: 'Gateway timeout', details: e.message });
  }
});

app.put('/api/robots/:id/tasks/:taskId', async (req, res) => {
  try {
    const result = await coapRequest(
      'PUT',
      `/robots/${req.params.id}/tasks/${req.params.taskId}`,
      req.body
    );
    res.status(result.httpStatus).json(result.data);
  } catch (e) {
    res.status(504).json({ error: 'Gateway timeout', details: e.message });
  }
});

app.delete('/api/robots/:id/tasks/:taskId', async (req, res) => {
  try {
    const result = await coapRequest(
      'DELETE',
      `/robots/${req.params.id}/tasks/${req.params.taskId}`
    );
    res.status(result.httpStatus).json(result.data);
  } catch (e) {
    res.status(504).json({ error: 'Gateway timeout', details: e.message });
  }
});

app.listen(HTTP_PORT, () => {
  console.log(`HTTP gateway started on port ${HTTP_PORT}`);
});