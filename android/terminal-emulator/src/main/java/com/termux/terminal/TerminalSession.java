package com.termux.terminal;

import android.os.Handler;
import android.os.Looper;
import android.os.Message;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * A terminal session: the emulator plus the connection that feeds it.
 *
 * Changed for Router Home (see NOTICE): Termux's TerminalSession starts a local
 * shell through native code. This one is fed by a network connection (SSH):
 * - {@link #feed} hands it what the router sent (any thread)
 * - {@link #setLink} gives it where typed input and size changes go
 * - {@link #disconnected} marks the end of the connection
 * The public methods TerminalView uses are the same as Termux's.
 */
public final class TerminalSession extends TerminalOutput {

    /** Where typed input and window size changes go: the SSH channel. */
    public interface Link {
        /** Called on the main thread: must not block (hand it to another thread). */
        void send(byte[] data);

        void resize(int columns, int rows, int widthPixels, int heightPixels);
    }

    private static final int MSG_NEW_INPUT = 1;
    private static final int MSG_DISCONNECTED = 2;

    /** A queue written to by the network thread and read by the main thread. */
    final ByteQueue mProcessToTerminalIOQueue = new ByteQueue(64 * 1024);

    /** Buffer to write translate code points into utf8 before writing to the link. */
    private final byte[] mUtf8InputBuffer = new byte[5];

    public final String mHandle = UUID.randomUUID().toString();
    public String mSessionName;

    TerminalEmulator mEmulator;
    TerminalSessionClient mClient;
    private final Integer mTranscriptRows;

    private volatile Link mLink;
    private volatile boolean mConnected;
    private int mColumns, mRows, mCellWidth, mCellHeight;

    final Handler mMainThreadHandler = new Handler(Looper.getMainLooper()) {
        final byte[] mReceiveBuffer = new byte[64 * 1024];

        @Override
        public void handleMessage(Message msg) {
            int bytesRead = mProcessToTerminalIOQueue.read(mReceiveBuffer, false);
            if (bytesRead > 0 && mEmulator != null) {
                mEmulator.append(mReceiveBuffer, bytesRead);
                notifyScreenUpdate();
            }
            if (msg.what == MSG_DISCONNECTED) mClient.onSessionFinished(TerminalSession.this);
        }
    };

    public TerminalSession(Integer transcriptRows, TerminalSessionClient client) {
        this.mTranscriptRows = transcriptRows;
        this.mClient = client;
    }

    public void updateTerminalSessionClient(TerminalSessionClient client) {
        mClient = client;
        if (mEmulator != null) mEmulator.updateTerminalSessionClient(client);
    }

    /* ---------------- the connection ---------------- */

    /** Connects typed input and size changes to a link (or null to drop them). */
    public void setLink(Link link) {
        mLink = link;
        mConnected = link != null;
        if (link != null && mColumns > 0) link.resize(mColumns, mRows, mColumns * mCellWidth, mRows * mCellHeight);
    }

    /** What the connection received, to show. Any thread. */
    public void feed(byte[] data, int length) {
        if (length <= 0) return;
        if (!mProcessToTerminalIOQueue.write(data, 0, length)) return;
        mMainThreadHandler.sendEmptyMessage(MSG_NEW_INPUT);
    }

    /** Text from the app itself ("Connecting…"), shown like received text. Any thread. */
    public void print(String text) {
        byte[] b = text.getBytes(StandardCharsets.UTF_8);
        feed(b, b.length);
    }

    /** The connection ended. Any thread. */
    public void disconnected() {
        mLink = null;
        mConnected = false;
        mMainThreadHandler.sendEmptyMessage(MSG_DISCONNECTED);
    }

    /* ---------------- what TerminalView uses ---------------- */

    /** Set the terminal size; the first call creates the emulator. */
    public void updateSize(int columns, int rows, int cellWidthPixels, int cellHeightPixels) {
        mColumns = columns;
        mRows = rows;
        mCellWidth = cellWidthPixels;
        mCellHeight = cellHeightPixels;
        if (mEmulator == null) {
            mEmulator = new TerminalEmulator(this, columns, rows, cellWidthPixels, cellHeightPixels, mTranscriptRows, mClient);
        } else {
            mEmulator.resize(columns, rows, cellWidthPixels, cellHeightPixels);
        }
        Link l = mLink;
        if (l != null) l.resize(columns, rows, columns * cellWidthPixels, rows * cellHeightPixels);
    }

    public int getColumns() {
        return mColumns;
    }

    public int getRows() {
        return mRows;
    }

    public String getTitle() {
        return (mEmulator == null) ? null : mEmulator.getTitle();
    }

    /** Typed input (and the emulator's own replies) to the connection. */
    @Override
    public void write(byte[] data, int offset, int count) {
        Link l = mLink;
        if (l == null || count <= 0) return;
        byte[] copy = new byte[count];
        System.arraycopy(data, offset, copy, 0, count);
        l.send(copy);
    }

    /** Write the Unicode code point to the terminal encoded in UTF-8. */
    public void writeCodePoint(boolean prependEscape, int codePoint) {
        if (codePoint > 1114111 || (codePoint >= 0xD800 && codePoint <= 0xDFFF)) {
            // 1114111 (= 2**16 + 1024**2 - 1) is the highest code point, [0xD800,0xDFFF] is the surrogate range.
            throw new IllegalArgumentException("Invalid code point: " + codePoint);
        }

        int bufferPosition = 0;
        if (prependEscape) mUtf8InputBuffer[bufferPosition++] = 27;

        if (codePoint <= /* 7 bits */0b1111111) {
            mUtf8InputBuffer[bufferPosition++] = (byte) codePoint;
        } else if (codePoint <= /* 11 bits */0b11111111111) {
            mUtf8InputBuffer[bufferPosition++] = (byte) (0b11000000 | (codePoint >> 6));
            mUtf8InputBuffer[bufferPosition++] = (byte) (0b10000000 | (codePoint & 0b111111));
        } else if (codePoint <= /* 16 bits */0b1111111111111111) {
            mUtf8InputBuffer[bufferPosition++] = (byte) (0b11100000 | (codePoint >> 12));
            mUtf8InputBuffer[bufferPosition++] = (byte) (0b10000000 | ((codePoint >> 6) & 0b111111));
            mUtf8InputBuffer[bufferPosition++] = (byte) (0b10000000 | (codePoint & 0b111111));
        } else {
            mUtf8InputBuffer[bufferPosition++] = (byte) (0b11110000 | (codePoint >> 18));
            mUtf8InputBuffer[bufferPosition++] = (byte) (0b10000000 | ((codePoint >> 12) & 0b111111));
            mUtf8InputBuffer[bufferPosition++] = (byte) (0b10000000 | ((codePoint >> 6) & 0b111111));
            mUtf8InputBuffer[bufferPosition++] = (byte) (0b10000000 | (codePoint & 0b111111));
        }
        write(mUtf8InputBuffer, 0, bufferPosition);
    }

    public TerminalEmulator getEmulator() {
        return mEmulator;
    }

    /** Notify the {@link #mClient} that the screen has changed. */
    protected void notifyScreenUpdate() {
        mClient.onTextChanged(this);
    }

    /** Reset state for terminal emulator state. */
    public void reset() {
        if (mEmulator == null) return;
        mEmulator.reset();
        notifyScreenUpdate();
    }

    /** Nothing to kill: the app closes the connection itself. */
    public void finishIfRunning() {
    }

    @Override
    public void titleChanged(String oldTitle, String newTitle) {
        mClient.onTitleChanged(this);
    }

    public boolean isRunning() {
        return mConnected;
    }

    public int getExitStatus() {
        return 0;
    }

    @Override
    public void onCopyTextToClipboard(String text) {
        mClient.onCopyTextToClipboard(this, text);
    }

    @Override
    public void onPasteTextFromClipboard() {
        mClient.onPasteTextFromClipboard(this);
    }

    @Override
    public void onBell() {
        mClient.onBell(this);
    }

    @Override
    public void onColorsChanged() {
        mClient.onColorsChanged(this);
    }

    /** There's no local process. */
    public int getPid() {
        return -1;
    }

    public String getCwd() {
        return null;
    }
}
