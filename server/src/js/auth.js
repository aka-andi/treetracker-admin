const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const generator = require('generate-password');
const Crypto = require('crypto');
const bodyParser = require('body-parser');
const config = require('../config');
const {Pool, Client} = require('pg');
const {utils} = require('./utils');
const db = require('../datasources/treetracker.datasource.json');

const app = express();
//const pool = new Pool({ connectionString: "postgres://deanchen:@localhost:5432/postgres"});
//const pool = new Pool({ connectionString: "postgresql://doadmin:l5al4hwte8qmj6x8@db-postgresql-sfo2-nextgen-do-user-1067699-0.db.ondigitalocean.com:25060/treetracker_dev?ssl=true"});
//const pool = new Pool({ connectionString: "postgres://treetracker:tr33dev@107.170.246.116:5432/treetracker"});
//const pool = new Pool({ connectionString: "postgresql://doadmin:g7a1fey4jeqao9mg@db-postgresql-sfo2-40397-do-user-1067699-0.db.ondigitalocean.com:25060/treetracker?ssl=true"});
const pool = new Pool({connectionString: db.url});
const jwtSecret = config.jwtSecret;
console.log(jwtSecret);

const PERMISSIONS = {
  ADMIN: 1,
  TREE_AUDITOR: 2,
  PLANTER_MANAGER: 3,
};

const user = {
  id: 1,
  username: 'dadiorchen',
  firstName: 'Dadior',
  lastName: 'Chen',
  password: '123456',
  role: [0, 1],
  email: 'dadiorchen@outlook.com',
};

const userB = {
  id: 2,
  username: 'bbb',
  firstName: 'B',
  lastName: 'B',
  password: '123456',
  role: [1],
  email: 'b@outlook.com',
};

const sha512 = function(password, salt) {
  let hash = Crypto.createHmac('sha512', salt);
  hash.update(password);
  const hashedPwd = hash.digest('hex');
  return hashedPwd;
};

const generateSalt = function() {
  const generated = generator.generate({length: 6, numbers: true});
  return generated;
};

const permissions = [
  {
    id: 0,
    name: 'Admin',
    description: 'Admin pemission',
  },
  {
    id: 1,
    name: 'Tree Auditor',
    description: 'Veify & view trees',
  },
  {
    id: 2,
    name: 'Planter Manager',
    description: 'Check & manage planters',
  },
];

const users = [user, userB];

const jsonParser = app.use(bodyParser.urlencoded({extended: false})); // parse application/json
// const urlencodedParser = app.use(bodyParser.json());/// parse application/x-www-form-urlencoded

router.get('/permissions', async function login(req, res, next) {
  try {
    const result = await pool.query(`select * from admin_role`);
    res.status(200).json(result.rows.map(r => utils.convertCamel(r)));
  } catch (e) {
    console.error(e);
    res.status(500).json();
  }
});

router.post('/login', async function login(req, res, next) {
  try {
    //try to init, in case of first visit
    await init();
    const {userName, password} = req.body;

    //find the user to get the salt, validate if hashed password matches
    let user_rows = await pool.query(
      `select * from admin_user where user_name = '${userName}'`,
    ); /*TODO check if user name exists*/

    const user_entity = user_rows.rows[0];
    const hash = sha512(password, user_entity.salt);

    let result = await pool.query(
      `select * from admin_user where user_name = '${userName}' and password_hash = '${hash}'`,
    );
    let userLogin;
    if (result.rows.length === 1) {
      userLogin = utils.convertCamel(result.rows[0]);
      //load role
      console.assert(userLogin.id >= 0, 'id?', userLogin);
      result = await pool.query(
        `select * from admin_user_role where admin_user_id = ${userLogin.id}`,
      );
      userLogin.role = result.rows.map(r => r.role_id);
    }

    if (userLogin) {
      //TODO get user
      const token = await jwt.sign(userLogin, jwtSecret);
      const {userName, firstName, lastName, email, role} = userLogin;
      return res.json({
        token,
        user: {userName, firstName, lastName, email, role},
      });
    } else {
      return res.status(401).json();
    }
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.get('/test', async function login(req, res, next) {
  res.send('OK');
});

router.get('/admin_users/:userId', async (req, res, next) => {
  try {
    //console.log(pool);
    let result = await pool.query(
      `select * from admin_user where id=${req.params.userId}`,
    );
    let userGet;
    if (result.rows.length === 1) {
      userGet = utils.convertCamel(result.rows[0]);
      //load role
      result = await pool.query(
        `select * from admin_user_role where role_id = ${userGet.id}`,
      );
      userGet.role = result.rows.map(r => r.role_id);
    }
    if (userGet) {
      res.status(200).json(userGet);
    } else {
      res.status(404).json();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json();
  }
});

router.put(
  '/admin_users/:userId/password',
  jsonParser,
  async (req, res, next) => {
    try {
      const salt = generateSalt();
      const hash = sha512(req.body.password, salt);
      const result = await pool.query(
        `update admin_user set password_hash = '${hash}', salt = '${salt}' where id = ${req.params.userId}`,
      );
      res.status(200).json();
    } catch (e) {
      console.error(e);
      res.status(500).json();
    }
  },
);

router.patch('/admin_users/:userId', async (req, res, next) => {
  try {
    const update = `update admin_user set ${utils.buildUpdateFields(
      req.body,
    )} where id = ${req.params.userId}`;
    console.log('update:', update);
    let result = await pool.query(update);
    //role
    result = await pool.query(
      `delete from admin_user_role where admin_user_id = ${req.params.userId}`,
    );
    if (req.body.role) {
      for (let i = 0; i < req.body.role.length; i++) {
        let result = await pool.query(
          `insert into admin_user_role (role_id, admin_user_id) values (${req.body.role[i]},${req.params.userId})`,
        );
      }
    }
    res.status(200).json();
  } catch (e) {
    console.error(e);
    res.status(500).json();
  }
});

router.delete('/admin_users/:userId', async (req, res, next) => {
  try {
    //roles
    let deletestatement = `delete from admin_user_role where admin_user_id = ${req.params.userId}`;
    console.log('delete:', deletestatement);
    let result = await pool.query(deletestatement);
    //user
    deletestatement = `delete from admin_user where admin_user_id = ${req.params.userId}`;
    console.log('delete:', deletestatement);
    result = await pool.query(deletestatement);
    res.status(204).json();
  } catch (e) {
    console.error(e);
    res.status(500).json();
  }
});

router.get('/admin_users/', async (req, res, next) => {
  try {
    let result = await pool.query(`select * from admin_user`);
    const users = [];
    for (let i = 0; i < result.rows.length; i++) {
      const r = result.rows[i];
      const roles = await pool.query(
        `select * from admin_user_role where admin_user_id = ${r.id}`,
      );
      r.role = roles.rows.map(rr => rr.role_id);
      users.push(utils.convertCamel(r));
    }
    res.status(200).json(users);
  } catch (e) {
    console.error(e);
    res.status(500).json();
  }
});

router.post('/validate/', async (req, res, next) => {
  try {
    const {password} = req.body;
    const token = req.headers.authorization;
    const decodedToken = jwt.verify(token, jwtSecret);
    const userSession = decodedToken;
    const hash = sha512(password, userSession.salt);

    if (hash === userSession.passwordHash) {
      return res.status(200).json();
    } else {
      return res.status(401).json();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json();
  }
});

router.post('/admin_users/', async (req, res, next) => {
  try {
    req.body.passwordHash = req.body.password;
    delete req.body.password;
    let result = await pool.query(
      `select * from admin_user where user_name = '${req.body.userName}'`,
    );
    if (result.rows.length === 1) {
      //TODO 401
      res.status(201).json({id: result.rows[0].id});
      return;
    }
    const insert = `insert into admin_user ${utils.buildInsertFields(
      req.body,
    )}`;
    console.log('insert:', insert);
    await pool.query(insert);
    result = await pool.query(
      `select * from admin_user where user_name = '${req.body.userName}'`,
    );
    let obj;
    if (result.rows.length === 1) {
      obj = result.rows[0];
      //roles
      //role
      await pool.query(
        `delete from admin_user_role where admin_user_id = ${obj.id}`,
      );
      for (let i = 0; i < req.body.role.length; i++) {
        const insertRole = `insert into admin_user_role (role_id, admin_user_id) values (${req.body.role[i]},${obj.id})`;
        console.log('insert role:', insertRole);
        await pool.query(insertRole);
      }
    } else {
      throw new Error('can not find new user');
    }
    res.status(201).json({id: obj.id});
  } catch (e) {
    console.error(e);
    res.status(500).json();
  }
});

async function init() {
  console.log('Begin init...');
  const result = await pool.query(`select * from admin_user `);
  if (result.rows.length > 0) {
    console.log('There are accounts in admin user, quit.');
    return;
  }
  console.log('clean...');
  await pool.query('delete from admin_user');
  await pool.query('delete from admin_user_role');
  await pool.query('delete from admin_role');
  await pool.query(
    `insert into admin_role (id, role_name, description) ` +
      `values (1, 'Admin', 'The super administrator role, having all permissions'),` +
      `(2, 'Tree Manager', 'Check, verify, manage trees'),` +
      `(3, 'Planter Manager', 'Check, manage planters')`,
  );
  await pool.query(
    `insert into admin_user (id, user_name, first_name, last_name, password_hash, salt, email, active) ` +
      `values ( 1, 'admin', 'Admin', 'Panel', 'b6d86a90ad11945342ca3253e90a817dd6d3c76f1c97a7eda3ea8dea758f2dce527afe6016bf861623b4caecd8464332d91553cb093aa5b5165b1b58744af13e', 'aLWYuZ','admin@greenstand.org', true),` +
      `(2, 'test', 'Admin', 'Test', '539430ec2a48fd607b6e06f3c3a7d3f9b46ac5acb7e81b2633678a8fe3ce6216e2abdfa2bc41bbaa438ba55e5149efb7ad522825d9e98df5300b801c7f8d2c86', 'WjSO0T','test@greenstand.org', true)`,
  );
  await pool.query(
    `insert into admin_user_role (id, role_id, admin_user_id) ` +
      `values ( 1, 1, 1), ` +
      `(2, 2, 2), ` +
      `(3, 3, 2)`,
  );
}

router.post('/init', async (req, res, next) => {
  try {
    await init();
    res.status(200).json();
  } catch (e) {
    console.error(e);
    res.status(500).json();
  }
});

const isAuth = (req, res, next) => {
  //white list
  //console.error("req.originalUrl", req.originalUrl);
  const url = req.originalUrl;
  if (url === '/auth/login' || url === '/auth/test' || url === '/auth/init') {
    next();
    return;
  }
  try {
    const token = req.headers.authorization;
    const decodedToken = jwt.verify(token, jwtSecret);
    const userSession = decodedToken;
    req.user = userSession;
    const roles = userSession.role;
    if (url.match(/\/auth\/check_token/)) {
      //cuz can decode token,pass
      console.log('auth check');
      res.status(200).json({});
      return;
    }
    if (url.match(/\/auth\/(?!login).*/)) {
      //if role is admin, then can do auth stuff
      if (userSession.role.some(r => r === PERMISSIONS.ADMIN)) {
        next();
        return;
      } else {
        res.status(401).json({
          error: new Error('No permission'),
        });
        return;
      }
    } else if (url.match(/\/api\/.*/)) {
      if (url.match(/\/api\/species.*/)) {
        next();
        return;
      } else if (url.match(/\/api\/trees.*/)) {
        if (
          roles.includes(PERMISSIONS.ADMIN) ||
          roles.includes(PERMISSIONS.TREE_AUDITOR)
        ) {
          next();
          return;
        } else {
          res.status(401).json({
            error: new Error('No permission'),
          });
          return;
        }
      } else if (url.match(/\/api\/planter.*/)) {
        if (
          roles.includes(PERMISSIONS.ADMIN) ||
          roles.includes(PERMISSIONS.PLANTER_MANAGER)
        ) {
          next();
          return;
        } else {
          res.status(401).json({
            error: new Error('No permission'),
          });
          return;
        }
      }
    } else {
      next();
      return;
    }
    res.status(401).json({
      error: new Error('No permission'),
    });
    //res.status(200).json([user]);
  } catch (e) {
    console.warn(e);
    res.status(401).json({
      error: new Error('Invalid request!'),
    });
  }
};

exports.auth = {
  router,
  isAuth,
};
