document.addEventListener('DOMContentLoaded', function() {
  showTopTab('top-new');
  showTab('new-tab1');
  ['new-tab1','new-tab2','new-tab3','new-tab4',
   'rec-tab1','rec-tab2','rec-tab3','rec-tab4'
  ].forEach(initFilters);
});

function showTab(id) {
  document.querySelectorAll('.tab-content:not(.top)')
          .forEach(t=>t.style.display='none');
  document.getElementById(id).style.display='block';
  document.querySelectorAll('.tab-label')
          .forEach(l=>l.classList.remove('active'));
  document.getElementById(id+'-label').classList.add('active');
}

function showTopTab(id) {
  document.querySelectorAll('.tab-content.top')
          .forEach(t=>t.style.display='none');
  document.getElementById(id).style.display='block';
  document.querySelectorAll('.tab-label.top')
          .forEach(l=>l.classList.remove('active'));
  document.getElementById(id+'-label').classList.add('active');

  // Auto-select first subtab when switching between top tabs
  if (id === 'top-new') {
    showTab('new-tab1');
  } else if (id === 'top-rec') {
    showTab('rec-tab1');
  }
}

function initFilters(tabId) {
  const tab = document.getElementById(tabId);
  if (!tab) return;
  // client filter
  const clients = new Set();
  tab.querySelectorAll('.client-section-header div:first-child')
     .forEach(d=>clients.add(d.textContent.trim()));
  const cs = document.getElementById(tabId+'-client-filter');
  if (cs) {
    cs.innerHTML = '<option value="all">All Clients</option>';
    clients.forEach(c=>cs.innerHTML+=`<option value="${c}">${c}</option>`);
  }
  // severity filter
  const sevs = new Set();
  tab.querySelectorAll('.severity-badge')
     .forEach(b=>sevs.add(b.textContent.trim()));
  const ss = document.getElementById(tabId+'-severity-filter');
  if (ss) {
    ss.innerHTML = '<option value="all">All Severities</option>';
    ['High','Medium','Low'].forEach(s=> {
      if(sevs.has(s)) ss.innerHTML+=`<option value="${s}">${s}</option>`;
    });
  }
}

function applyFilters(tabId) {
  const tab = document.getElementById(tabId);
  if (!tab) return;
  const clientVal = document.getElementById(tabId+'-client-filter').value;
  const sevVal    = document.getElementById(tabId+'-severity-filter').value;
  tab.querySelectorAll('.client-section').forEach(sec=>{
    const name = sec.querySelector('.client-section-header div:first-child')
                    .textContent.trim();
    let show = (clientVal==='all'||name===clientVal);
    if(show && sevVal!=='all') {
      let any=false;
      sec.querySelectorAll('.error-item').forEach(item=>{
        const s=item.querySelector('.severity-badge').textContent.trim();
        item.style.display = (s===sevVal)?'':'none';
        if(s===sevVal) any=true;
      });
      show = any;
    } else if(show) {
      sec.querySelectorAll('.error-item')
         .forEach(item=>item.style.display='');
    }
    sec.style.display = show?'':'none';
  });
  const visible = Array.from(tab.querySelectorAll('.client-section'))
                       .some(s=>s.style.display!=='none');
  const msg = tab.querySelector('.no-matches-message');
  if(msg) msg.style.display = visible?'none':'block';
}

function resetFilters(tabId) {
  ['client','severity'].forEach(f=>{
    const sel = document.getElementById(tabId+'-'+f+'-filter');
    if(sel) sel.value='all';
  });
  applyFilters(tabId);
}
