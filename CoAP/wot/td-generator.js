function buildRobotTD(robot, baseUrl = "http://localhost:3000") {
  return {
    "@context": [
      "https://www.w3.org/2022/wot/td/v1.1",
      `${baseUrl}/api/wot/context`
    ],
    id: `${baseUrl}/api/td/${robot.id}`,
    title: robot.name,
    description: `WoT Thing Description for robot vacuum ${robot.name}`,
    type: ["Thing", "RobotVacuum"],

    properties: {
      status: {
        title: "Robot status",
        type: "string",
        readOnly: true,
        forms: [
          {
            href: `${baseUrl}/api/robots/${robot.id}/status`,
            op: "readproperty",
            contentType: "application/json"
          }
        ]
      },
      battery: {
        title: "Battery level",
        type: "number",
        unit: "percent",
        readOnly: true,
        forms: [
          {
            href: `${baseUrl}/api/robots/${robot.id}/status`,
            op: "readproperty",
            contentType: "application/json"
          }
        ]
      },
      currentTask: {
        title: "Current task",
        type: "string",
        readOnly: true,
        forms: [
          {
            href: `${baseUrl}/api/robots/${robot.id}/status`,
            op: "readproperty",
            contentType: "application/json"
          }
        ]
      }
    },

    actions: {
      createTask: {
        title: "Create new cleaning task",
        input: {
          type: "object",
          properties: {
            title: { type: "string" }
          },
          required: ["title"]
        },
        forms: [
          {
            href: `${baseUrl}/api/robots/${robot.id}/tasks`,
            op: "invokeaction",
            contentType: "application/json"
          }
        ]
      },
      updateTask: {
        title: "Update existing task",
        input: {
          type: "object",
          properties: {
            id: { type: "number" },
            title: { type: "string" },
            status: {
              type: "string",
              enum: ["pending", "done"]
            }
          },
          required: ["id"]
        },
        forms: [
          {
            href: `${baseUrl}/api/robots/${robot.id}/tasks/{taskId}`,
            op: "invokeaction",
            contentType: "application/json"
          }
        ]
      },
      deleteTask: {
        title: "Delete task",
        input: {
          type: "object",
          properties: {
            id: { type: "number" }
          },
          required: ["id"]
        },
        forms: [
          {
            href: `${baseUrl}/api/robots/${robot.id}/tasks/{taskId}`,
            op: "invokeaction",
            contentType: "application/json"
          }
        ]
      }
    },

    events: {
      statusChanged: {
        title: "Robot status changed",
        data: {
          type: "string"
        },
        forms: [
          {
            href: `${baseUrl}/api/robots/${robot.id}/status`,
            subprotocol: "longpoll",
            contentType: "application/json"
          }
        ]
      }
    },

    links: [
      {
        rel: "self",
        href: `${baseUrl}/api/td/${robot.id}`,
        type: "application/td+json"
      },
      {
        rel: "collection",
        href: `${baseUrl}/api/td`,
        type: "application/json"
      }
    ]
  };
}

function buildTDDirectory(robots, baseUrl = "http://localhost:3000") {
  return {
    title: "Robot Vacuum TD Directory",
    description: "Directory of available robot vacuum Things",
    count: robots.length,
    things: robots.map(robot => ({
      id: robot.id,
      name: robot.name,
      type: "RobotVacuum",
      td: `${baseUrl}/api/td/${robot.id}`
    })),
    links: [
      {
        rel: "self",
        href: `${baseUrl}/api/td`,
        type: "application/json"
      },
      {
        rel: "search",
        href: `${baseUrl}/api/td/search?type=RobotVacuum`,
        type: "application/json"
      }
    ]
  };
}

module.exports = {
  buildRobotTD,
  buildTDDirectory
};