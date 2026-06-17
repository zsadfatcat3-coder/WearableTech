import os
import sys
import socket
import threading
import time
import json
import copy
import csv
import math
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_sock import Sock

if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

app = Flask(__name__)
CORS(app)
sock = Sock(app)

# ================= تهيئة ملفات الـ Excel =================
CSV_CHEST = "Distributed_Chest_Vitals.csv"
CSV_THIGH = "Distributed_Thigh_Movement.csv"

f_chest = open(CSV_CHEST, mode='w', newline='', encoding='utf-8')
w_chest = csv.writer(f_chest)
w_chest.writerow(["Timestamp(ms)", "Temp(C)", "HeartRate(BPM)", "SpO2(%)", "Battery(%)", "Charge_Status"])

f_thigh = open(CSV_THIGH, mode='w', newline='', encoding='utf-8')
w_thigh = csv.writer(f_thigh)
w_thigh.writerow(["Roll(Deg)", "Pitch(Deg)", "Yaw(Deg)", "Accel_X", "Accel_Y", "Accel_Z", "Steps", "Activity", "EMG_Envelope", "Battery(%)", "Charge_Status"])

# ================= مخازن البيانات =================
latest_hardware_vitals = {
    "chest": {"temp": None, "hr": None, "spo2": None, "battery": None, "status": "Offline", "ecgSamples": []},
    "thigh": {"roll": None, "pitch": None, "accel": None, "steps": "0", "activity": "Still", "emg": None, "battery": None, "status": "Offline", "emgSamples": []}
}

lock = threading.Lock()
connected_clients = set()

def _with_cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    return response

@app.after_request
def add_cors_headers(response):
    return _with_cors(response)

# ================= 📡 مستقبل الـ UDP اللحظي المستقل =================
def udp_receiver_loop():
    UDP_IP = "0.0.0.0"
    PORT_CHEST = 12345
    PORT_THIGH = 12346
    
    try:
        sock_chest = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock_chest.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock_chest.bind((UDP_IP, PORT_CHEST))
        sock_chest.setblocking(False)
        
        sock_thigh = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock_thigh.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock_thigh.bind((UDP_IP, PORT_THIGH))
        sock_thigh.setblocking(False)
        
        print("📡 Dual-Node System Hub Online (Zero-Latency Independent Mode)!")
        
        last_chest_time = time.time()
        last_thigh_time = time.time()
        
        while True:
            current_time = time.time()
            
            # ---------------- 1. الشفط الكامل للصدر (مستقل) ----------------
            while True:
                try:
                    data_ch, addr_ch = sock_chest.recvfrom(2048)
                    packet_ch = data_ch.decode('utf-8').strip().split(',')
                    with lock:
                        if packet_ch[0] == "E" and len(packet_ch) >= 2:
                            ecg_volt = (float(packet_ch[1]) / 4095.0) * 3.3
                            latest_hardware_vitals["chest"]["ecgSamples"].append(ecg_volt)
                            last_chest_time = current_time
                        elif packet_ch[0] == "CH" and len(packet_ch) >= 7:
                            w_chest.writerow(packet_ch[1:])
                            f_chest.flush() 
                            latest_hardware_vitals["chest"]["temp"] = packet_ch[2]
                            latest_hardware_vitals["chest"]["hr"] = packet_ch[3]
                            latest_hardware_vitals["chest"]["spo2"] = packet_ch[4]
                            latest_hardware_vitals["chest"]["battery"] = packet_ch[5]
                            latest_hardware_vitals["chest"]["status"] = "Online"
                            last_chest_time = current_time
                            print(f" 🏥 [CHEST] -> Temp: {packet_ch[2]}°C | HR: {packet_ch[3]} bpm | SpO2: {packet_ch[4]}% | Bat: {packet_ch[5]}%")
                except (BlockingIOError, ValueError, IndexError): 
                    break
                    
            # ---------------- 2. الشفط الكامل للفخذ (مستقل) ----------------
            while True:
                try:
                    data_th, addr_th = sock_thigh.recvfrom(2048)
                    packet_th = data_th.decode('utf-8').strip().split(',')
                    with lock:
                        if packet_th[0] == "M" and len(packet_th) >= 3:
                            emg_volt = (float(packet_th[1]) / 4095.0) * 3.3
                            latest_hardware_vitals["thigh"]["emgSamples"].append(emg_volt)
                            last_thigh_time = current_time
                        elif packet_th[0] == "TH" and len(packet_th) >= 12:
                            w_thigh.writerow(packet_th[1:])
                            f_thigh.flush()
                            
                            # حساب محصلة التسارع الفعلية 
                            acc_x, acc_y, acc_z = float(packet_th[4]), float(packet_th[5]), float(packet_th[6])
                            total_accel = round(math.sqrt(acc_x**2 + acc_y**2 + acc_z**2), 2)
                            
                            latest_hardware_vitals["thigh"]["roll"] = packet_th[1]
                            latest_hardware_vitals["thigh"]["pitch"] = packet_th[2]
                            latest_hardware_vitals["thigh"]["accel"] = total_accel
                            latest_hardware_vitals["thigh"]["steps"] = packet_th[7]
                            latest_hardware_vitals["thigh"]["activity"] = packet_th[8]
                            latest_hardware_vitals["thigh"]["emg"] = packet_th[9]
                            latest_hardware_vitals["thigh"]["battery"] = packet_th[10].replace("%", "")
                            latest_hardware_vitals["thigh"]["status"] = "Online"
                            last_thigh_time = current_time
                            print(f" 🦵 [THIGH] -> Accel: {total_accel} m/s² | Steps: {packet_th[7]} | Act: {packet_th[8]} | EMG: {packet_th[9]}")
                except (BlockingIOError, ValueError, IndexError): 
                    break
                
            # ---------------- 3. حارس الفصل اللحظي ----------------
            with lock:
                if current_time - last_chest_time > 1.2:
                    latest_hardware_vitals["chest"]["status"] = "Offline"
                if current_time - last_thigh_time > 1.2:
                    latest_hardware_vitals["thigh"]["status"] = "Offline"
            
            time.sleep(0.005)
    except Exception as e:
        print(f"❌ Receiver Error: {e}")
        time.sleep(2)
        udp_receiver_loop()

def get_vitals_data():
    with lock:
        data_to_send = copy.deepcopy(latest_hardware_vitals)
        latest_hardware_vitals["chest"]["ecgSamples"].clear()
        latest_hardware_vitals["thigh"]["emgSamples"].clear()
    return data_to_send

@sock.route('/api/vitals-stream')
def vitals_stream(ws):
    connected_clients.add(ws)
    try:
        while True:
            ws.send(json.dumps(get_vitals_data()))
            # 🟢 بث للموقع بسرعة فائقة (25 FPS) بدلاً من 5 FPS القديمة
            time.sleep(0.04) 
    except Exception:
        pass
    finally:
        connected_clients.discard(ws)

threading.Thread(target=udp_receiver_loop, daemon=True).start()

@app.route("/api/vitals", methods=["GET"])
def get_vitals():
    return jsonify(get_vitals_data()), 200

@app.route("/api/analyze-report", methods=["POST"])
def analyze_report():
    return jsonify({"suggestions": "### Clinical Status\n- Vitals are locally monitored.\n- Telemetry saved to CSV."}), 200

if __name__ == "__main__":
    print("🚀 Initiating Local IoT Server...")
    app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)