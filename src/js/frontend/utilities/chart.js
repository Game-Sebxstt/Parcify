import Chart from 'chart.js/auto';

const ctx = document.querySelectorAll('#myChart')
ctx.forEach((item) => {
  const myChart = new Chart(item.getContext('2d'), {
    type: 'line',
    data: {
        labels: ['Freefire', 'Desidia', 'Redcolsi', 'Redes', 'Bra', 'Maincra'],
        datasets: [{
            label: '# de Likes',
            data: [0, 300000, 200000, 100000, 400000, 300000],
            backgroundColor: [
                'rgba(255, 99, 132, 0.2)',
                'rgba(54, 162, 235, 0.2)',
                'rgba(255, 206, 86, 0.2)',
                'rgba(75, 192, 192, 0.2)',
                'rgba(153, 102, 255, 0.2)',
                'rgba(255, 159, 64, 0.2)'
            ],
            borderColor: [
                'rgba(255, 99, 132, 1)',
                'rgba(54, 162, 235, 1)',
                'rgba(255, 206, 86, 1)',
                'rgba(75, 192, 192, 1)',
                'rgba(153, 102, 255, 1)',
                'rgba(255, 159, 64, 1)'
            ],
            borderWidth: 1
        }]
    },
    options: {
      animations: {
        tension: {
          duration: 400,
        }
      },
      responsive:true,
      maintainAspectRatio:false,
        scales: {
            y: {
                beginAtZero: true,
                display:false
            },
            x:{
              display:false
            }
        },
        transitions: {
          show: {
            animations: {
              x: {
                from: 0
              },
              y: {
                from: 0
              }
            }
          },
          hide: {
            animations: {
              x: {
                to: 0
              },
              y: {
                to: 0
              }
            }
          }
        }
    }
  });
});