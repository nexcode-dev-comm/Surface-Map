// Force the browser to prompt for audio access
navigator.mediaDevices.getUserMedia({ audio: true })
  .then((stream) => {
    console.log("Access Granted!");
    // Close the tab automatically once authorization completes
    window.close(); 
  })
  .catch((err) => {
    document.body.innerHTML = `<h1>Error: ${err.message}</h1>`;
  });