// Como rodar:
// 1) npm install
// 2) node server.js
// 3) Acesse http://localhost:3000 (login: admin@contaflow.com / senha: admin123)

const path = require('path');
const express = require('express');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(session({
  secret: 'contaflow-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8, // 8 horas
  },
}));

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ erro: 'Não autenticado' });
  }
  next();
}

const authRoutes = require('./routes/auth');
const empresasRoutes = require('./routes/empresas');
const tarefasRoutes = require('./routes/tarefas');
const gruposRoutes = require('./routes/grupos');
const dashboardRoutes = require('./routes/dashboard');
const relatoriosRoutes = require('./routes/relatorios');
const usuariosRoutes = require('./routes/usuarios');
const processosRoutes = require('./routes/processos');

app.use('/api/auth', authRoutes);
app.use('/api/empresas', requireAuth, empresasRoutes);
app.use('/api/tarefas', requireAuth, tarefasRoutes);
app.use('/api/grupos', requireAuth, gruposRoutes);
app.use('/api/dashboard', requireAuth, dashboardRoutes);
app.use('/api/relatorios', requireAuth, relatoriosRoutes);
app.use('/api/usuarios', requireAuth, usuariosRoutes);
app.use('/api/processos', requireAuth, processosRoutes);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get(['/dashboard', '/empresas', '/empresas/:id', '/tarefas', '/grupos', '/relatorios', '/configuracoes'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.listen(PORT, () => {
  console.log(`ContaFlow rodando em http://localhost:${PORT}`);
});
