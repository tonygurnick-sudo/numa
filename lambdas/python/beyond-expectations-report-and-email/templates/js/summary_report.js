document.addEventListener('DOMContentLoaded', function() {
  showSummaryTab('summary-tab1');
  initCharts();
});

function showSummaryTab(id) {
  document.querySelectorAll('.summary-tab-content')
          .forEach(t=>t.style.display='none');
  document.getElementById(id).style.display='block';
  document.querySelectorAll('.summary-tab-label')
          .forEach(l=>l.classList.remove('active'));
  document.getElementById(id+'-label').classList.add('active');
}

function initCharts() {
  // Calculate dynamic height based on number of clients
  // Ensure minimum height of 400px and add 30px per client
  const clientCount = clientLabels.length;
  const dynamicHeight = Math.max(400, 200 + (clientCount * 30));

  // Set height for both chart containers
  document.getElementById('totalErrorsChart').parentNode.style.height = dynamicHeight + 'px';
  document.getElementById('uniqueErrorsChart').parentNode.style.height = dynamicHeight + 'px';

  new Chart(document.getElementById('totalErrorsChart').getContext('2d'), {
    type:'bar',
    data:{
      labels: clientLabels,
      datasets:[{
        label:'Total Errors',
        data: totalErrorsData,
        backgroundColor:'rgba(106,13,173,0.7)',
        borderColor:'rgba(106,13,173,1)',
        borderWidth:1
      }]
    },
    options:{
      indexAxis:'y',
      responsive:true,
      maintainAspectRatio: false,
      scales: {
        x: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Error Count'
          }
        },
        y: {
          ticks: {
            autoSkip: false,
            font: {
              size: 11
            },
            // Ensure enough padding between tick labels
            padding: 6,
            callback: function(value, index) {
              // Use the index to get the actual client name from clientLabels array
              const label = clientLabels[index];
              return label && label.length > 25 ? label.substr(0, 22) + '...' : label;
            }
          }
        }
      },
      plugins: {
        title: { display: true, text: 'Total Errors by Client' },
        tooltip: {
          callbacks: {
            title: function(tooltipItems) {
              // Show full client name in tooltip
              return clientLabels[tooltipItems[0].dataIndex];
            }
          }
        }
      }
    }
  });
  new Chart(document.getElementById('uniqueErrorsChart').getContext('2d'), {
    type:'bar',
    data:{
      labels: clientLabels,
      datasets:[{
        label:'Unique Errors',
        data: uniqueErrorsData,
        backgroundColor:'rgba(106,13,173,0.7)',
        borderColor:'rgba(106,13,173,1)',
        borderWidth:1
      }]
    },
    options:{
      indexAxis:'y',
      responsive:true,
      maintainAspectRatio: false,
      scales: {
        x: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Error Count'
          }
        },
        y: {
          ticks: {
            autoSkip: false,
            font: {
              size: 11
            },
            // Ensure enough padding between tick labels
            padding: 6,
            callback: function(value, index) {
              // Use the index to get the actual client name from clientLabels array
              const label = clientLabels[index];
              return label && label.length > 25 ? label.substr(0, 22) + '...' : label;
            }
          }
        }
      },
      plugins: {
        title: { display: true, text: 'Unique Errors by Client' },
        tooltip: {
          callbacks: {
            title: function(tooltipItems) {
              // Show full client name in tooltip
              return clientLabels[tooltipItems[0].dataIndex];
            }
          }
        }
      }
    }
  });
}

function updateTotalErrorsChart(filterType) {
  const ds = filterType==='all'
    ? [{ label:'Total Errors', data: totalErrorsData }]
    : [
        { label:'High',   data: highSeverityData   },
        { label:'Medium', data: mediumSeverityData },
        { label:'Low',    data: lowSeverityData    }
      ];
  const chart = Chart.getChart('totalErrorsChart');
  chart.data.datasets = ds;
  chart.update();
  document.querySelectorAll('.total-filter-button')
          .forEach(b=>b.classList.remove('active'));
  document.getElementById('total-'+filterType+'-filter')
          .classList.add('active');
}

function updateUniqueErrorsChart(filterType) {
  const ds = filterType==='all'
    ? [{ label:'Unique Errors', data: uniqueErrorsData }]
    : [
        { label:'High',   data: highSeverityData   },
        { label:'Medium', data: mediumSeverityData },
        { label:'Low',    data: lowSeverityData    }
      ];
  const chart = Chart.getChart('uniqueErrorsChart');
  chart.data.datasets = ds;
  chart.update();
  document.querySelectorAll('.unique-filter-button')
          .forEach(b=>b.classList.remove('active'));
  document.getElementById('unique-'+filterType+'-filter')
          .classList.add('active');
}
