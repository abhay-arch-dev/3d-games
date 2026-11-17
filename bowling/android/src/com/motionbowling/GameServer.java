package com.motionbowling;

import android.content.res.AssetManager;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Same job as server.js: serves the game files (bundled in the APK under assets/www)
 * and relays WebSocket messages between the TV and the phone pages.
 */
public final class GameServer {
    public static final int PORT = 3000;
    private static final String TAG = "Bowling";
    private static final String WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static GameServer instance;

    private final AssetManager assets;
    private final List<Client> clients = new CopyOnWriteArrayList<>();

    private static final class Client {
        final Socket socket;
        final OutputStream out;
        final String role;
        volatile boolean alive = true;
        Client(Socket s, OutputStream o, String r) { socket = s; out = o; role = r; }
    }

    public static synchronized void start(AssetManager assets) {
        if (instance != null) return;
        instance = new GameServer(assets);
        instance.listen();
    }

    private GameServer(AssetManager assets) { this.assets = assets; }

    private void listen() {
        Thread t = new Thread(() -> {
            try (ServerSocket server = new ServerSocket()) {
                server.setReuseAddress(true);
                server.bind(new InetSocketAddress(PORT));
                Log.i(TAG, "Server on port " + PORT + " " + lanAddresses());
                while (true) {
                    Socket s = server.accept();
                    s.setTcpNoDelay(true); // send motion data immediately
                    Thread h = new Thread(() -> handle(s), "conn");
                    h.setDaemon(true);
                    h.start();
                }
            } catch (IOException e) {
                Log.e(TAG, "Server stopped", e);
            }
        }, "http");
        t.setDaemon(true);
        t.start();

        // Drop clients that stop answering pings (e.g. TV switched off).
        Executors.newSingleThreadScheduledExecutor().scheduleAtFixedRate(() -> {
            for (Client c : clients) {
                if (!c.alive) { drop(c); continue; }
                c.alive = false;
                send(c, 0x9, new byte[0]);
            }
        }, 10, 10, TimeUnit.SECONDS);
    }

    // ---------------------------------------------------------------- HTTP

    private void handle(Socket s) {
        try {
            InputStream in = s.getInputStream();
            String requestLine = readLine(in);
            if (requestLine == null) { s.close(); return; }
            Map<String, String> headers = new HashMap<>();
            String h;
            while ((h = readLine(in)) != null && !h.isEmpty()) {
                int i = h.indexOf(':');
                if (i > 0) headers.put(h.substring(0, i).trim().toLowerCase(Locale.ROOT), h.substring(i + 1).trim());
            }
            String[] parts = requestLine.split(" ");
            String target = parts.length > 1 ? parts[1] : "/";
            String path = target;
            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q);
            path = URLDecoder.decode(path, "UTF-8");

            if ("/ws".equals(path) && "websocket".equalsIgnoreCase(headers.get("upgrade"))) {
                websocket(s, in, headers.get("sec-websocket-key"), target.contains("role=tv") ? "tv" : "controller");
                return;
            }
            serve(s, path);
        } catch (Exception e) {
            try { s.close(); } catch (IOException ignored) {}
        }
    }

    private void serve(Socket s, String path) throws IOException {
        OutputStream out = s.getOutputStream();
        if ("/api/info".equals(path)) {
            StringBuilder ips = new StringBuilder();
            for (String ip : lanAddresses()) ips.append(ips.length() > 0 ? "," : "").append('"').append(ip).append('"');
            int[] n = peerCounts();
            String body = "{\"port\":" + PORT + ",\"ips\":[" + ips + "],\"peers\":{\"tv\":" + n[0] + ",\"controller\":" + n[1] + "}}";
            respond(out, 200, "application/json", body.getBytes(StandardCharsets.UTF_8));
            s.close();
            return;
        }
        switch (path) {
            case "/": path = "/index.html"; break;
            case "/tv": case "/tv/": path = "/tv.html"; break;
            case "/controller": case "/controller/": case "/c": path = "/controller.html"; break;
            case "/camera": case "/camera/": path = "/camera.html"; break;
            default: break;
        }
        if (path.contains("..")) { respond(out, 403, "text/plain", "Forbidden".getBytes(StandardCharsets.UTF_8)); s.close(); return; }

        byte[] data;
        try (InputStream a = assets.open("www" + path)) {
            data = readAll(a);
        } catch (IOException e) {
            respond(out, 404, "text/plain", "Not found".getBytes(StandardCharsets.UTF_8));
            s.close();
            return;
        }
        respond(out, 200, mime(path), data);
        s.close();
    }

    private static void respond(OutputStream out, int code, String type, byte[] body) throws IOException {
        String status = code == 200 ? "OK" : code == 404 ? "Not Found" : "Forbidden";
        String head = "HTTP/1.1 " + code + " " + status + "\r\n"
                + "Content-Type: " + type + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Cache-Control: no-cache\r\n"
                + "Connection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.ISO_8859_1));
        out.write(body);
        out.flush();
    }

    private static String mime(String p) {
        if (p.endsWith(".html")) return "text/html; charset=utf-8";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    // ----------------------------------------------------------- WebSocket

    private void websocket(Socket s, InputStream rawIn, String key, String role) throws Exception {
        if (key == null) { s.close(); return; }
        String accept = Base64.getEncoder().encodeToString(
                MessageDigest.getInstance("SHA-1").digest((key + WS_GUID).getBytes(StandardCharsets.ISO_8859_1)));
        OutputStream out = s.getOutputStream();
        out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                + "Sec-WebSocket-Accept: " + accept + "\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
        out.flush();

        Client c = new Client(s, out, role);
        clients.add(c);
        Log.i(TAG, "+ " + role + " " + s.getInetAddress());
        broadcastPeers();

        DataInputStream in = new DataInputStream(rawIn);
        try {
            while (true) {
                int b0 = in.read();
                if (b0 < 0) break;
                int b1 = in.readUnsignedByte();
                int opcode = b0 & 0x0F;
                boolean masked = (b1 & 0x80) != 0;
                long len = b1 & 0x7F;
                if (len == 126) len = in.readUnsignedShort();
                else if (len == 127) len = in.readLong();
                if (len < 0 || len > (1 << 20)) break;
                byte[] mask = new byte[4];
                if (masked) in.readFully(mask);
                byte[] payload = new byte[(int) len];
                in.readFully(payload);
                if (masked) for (int i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
                c.alive = true;

                if (opcode == 0x8) break;
                if (opcode == 0x9) { send(c, 0xA, payload); continue; }
                if (opcode != 0x1) continue;
                relay(c, payload);
            }
        } catch (IOException ignored) {
        } finally {
            drop(c);
        }
    }

    private void relay(Client from, byte[] text) {
        String target = "tv".equals(from.role) ? "controller" : "tv";
        for (Client c : clients) if (c.role.equals(target)) send(c, 0x1, text);
    }

    private void send(Client c, int opcode, byte[] payload) {
        int len = payload.length;
        byte[] head;
        if (len < 126) head = new byte[]{(byte) (0x80 | opcode), (byte) len};
        else if (len < 65536) head = new byte[]{(byte) (0x80 | opcode), 126, (byte) (len >> 8), (byte) len};
        else {
            head = new byte[10];
            head[0] = (byte) (0x80 | opcode);
            head[1] = 127;
            for (int i = 0; i < 8; i++) head[9 - i] = (byte) ((long) len >> (8 * i));
        }
        try {
            synchronized (c.out) {
                c.out.write(head);
                c.out.write(payload);
                c.out.flush();
            }
        } catch (IOException e) {
            drop(c);
        }
    }

    private void drop(Client c) {
        if (!clients.remove(c)) return;
        try { c.socket.close(); } catch (IOException ignored) {}
        Log.i(TAG, "- " + c.role);
        broadcastPeers();
    }

    private int[] peerCounts() {
        int tv = 0, ctl = 0;
        for (Client c : clients) { if ("tv".equals(c.role)) tv++; else ctl++; }
        return new int[]{tv, ctl};
    }

    private void broadcastPeers() {
        int[] n = peerCounts();
        byte[] msg = ("{\"type\":\"peers\",\"tv\":" + n[0] + ",\"controller\":" + n[1] + "}").getBytes(StandardCharsets.UTF_8);
        for (Client c : clients) send(c, 0x1, msg);
    }

    // -------------------------------------------------------------- helpers

    /** Wi-Fi addresses first, so the TV address shown is the one on the home network. */
    public static List<String> lanAddresses() {
        List<String> wifi = new ArrayList<>(), other = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (!(a instanceof Inet4Address)) continue;
                    String name = ni.getName();
                    if (name.startsWith("wlan") || name.startsWith("ap") || name.startsWith("swlan")) wifi.add(a.getHostAddress());
                    else if (!name.startsWith("rmnet") && !name.startsWith("dummy")) other.add(a.getHostAddress());
                }
            }
        } catch (Exception ignored) {}
        wifi.addAll(other);
        return wifi;
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) >= 0) {
            if (c == '\n') break;
            if (c != '\r') b.write(c);
            if (b.size() > 8192) throw new IOException("Header too long");
        }
        if (c < 0 && b.size() == 0) return null;
        return b.toString("ISO-8859-1");
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream(Math.max(1024, in.available()));
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        return b.toByteArray();
    }
}
