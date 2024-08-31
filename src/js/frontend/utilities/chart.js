import Chart from 'chart.js/auto';

function formatLabels(startDate, endDate, dataLabels) {
  const labels = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  const diffInMonths = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
  const diffInYears = end.getFullYear() - start.getFullYear();
  const maxLabels = 10;
  let labelFormat = 'dates';

  if (dataLabels.length > maxLabels) {
    if (diffInYears > 1) {
      labelFormat = 'years';
    } else if (diffInMonths > 6) {
      labelFormat = 'months';
    }
  }

  if (labelFormat === 'years') {
    let year = start.getFullYear();
    while (year <= end.getFullYear()) {
      labels.push(year.toString());
      year++;
    }
  } else if (labelFormat === 'months') {
    let current = new Date(start);
    while (current <= end) {
      labels.push(`${current.getMonth()}/${current.getFullYear()}`);
      current.setMonth(current.getMonth());
    }
  } else {
    dataLabels.forEach(label => {
      console.log("label",label)
      const date = new Date(label);
      labels.push(`${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`);
    });
  }

  return labels;
}


export function createGraphic(element, typeGraphic, startDate, endDate, data, dataLabels, backGroundColor, borderColor, borderWidth) {
  const ctx = element.getContext('2d');
  
  const labels = formatLabels(startDate, endDate, dataLabels);

  const dataGraphic = {
    labels: labels,
    datasets: [
      {
        label: 'Sebxstt',
        data: data,
        backgroundColor: backGroundColor,
        borderColor: borderColor,
        borderWidth: borderWidth,
        fill: false,
      }
    ]
  };

  const config = {
    type: typeGraphic || 'line',
    data: dataGraphic,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true
        }
      },
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          display: false
        }
      },
    },
  };

  return new Chart(ctx, config);
}
