document.addEventListener('DOMContentLoaded', function () {
  const grantBtn = document.getElementById('grant-btn');
  const errorDiv = document.getElementById('error-msg');

  if (grantBtn) {
    grantBtn.addEventListener('click', function () {
      errorDiv.style.display = 'none';

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        errorDiv.textContent = "Media devices not supported in this context.";
        errorDiv.style.display = 'block';
        return;
      }

      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(function (stream) {
          setTimeout(function () {
            stream.getTracks().forEach(function (track) { track.stop(); });
            alert("Microphone access granted successfully! You can close this tab now.");
            window.close();
          }, 400);
        })
        .catch(function (err) {
          console.error("Mic access error details:", err);
          errorDiv.textContent = "Error: " + err.name + " - " + err.message;
          errorDiv.style.display = 'block';
        });
    });
  }
});