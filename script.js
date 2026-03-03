const fileInput = document.getElementById('fileInput');
const qrcodeContainer = document.getElementById('qrcode');
const status = document.getElementById('status');

fileInput.addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;

    // Check size - QR codes max out at ~2.9KB 
    if (file.size > 2800) {
        status.innerText = "Error: File too large. Must be under 2.8KB.";
        qrcodeContainer.style.display = "none";
        return;
    }

    const reader = new FileReader();
    
    reader.onload = function(e) {
        const fileData = e.target.result;
        
        // Clear previous QR code
        qrcodeContainer.innerHTML = "";
        qrcodeContainer.style.display = "block";

        try {
            new QRCode(qrcodeContainer, {
                text: fileData,
                width: 256,
                height: 256,
                correctLevel: QRCode.CorrectLevel.L // Low error correction to fit more data
            });
            status.innerText = `Success! Encoded: ${file.name}`;
        } catch (err) {
            status.innerText = "Error: Data too dense for QR code.";
        }
    };

    reader.readAsDataURL(file);
});