if(!localStorage.getItem('auth')) location='login.html';
function logout(){localStorage.removeItem('auth');location='login.html'}