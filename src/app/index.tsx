import * as Haptics from 'expo-haptics';
import { activateKeepAwake, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { MOCHI_HTML } from '@/mochi/mochi-html';

const KEEP_AWAKE_TAG = 'mochi-session';

// the page's sound effects, played as iOS haptics (web pages can't vibrate an iPhone)
const HAPTICS: Record<string, () => Promise<void>> = {
  tap: () => Haptics.selectionAsync(),
  select: () => Haptics.selectionAsync(),
  coin: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft),
  pet: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft),
  start: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  rest: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  wake: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  buy: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  done: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  warn: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  sad: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
};

/**
 * Mochi Farm runs as a web page inside a WebView. The page and this screen talk to each other:
 * - the page asks us to keep the screen on during a session ({ type: 'awake', on })
 * - we tell the page when the app goes to the background, so leaving still ends the session
 */
export default function MochiScreen() {
  const web = useRef<WebView>(null);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      web.current?.injectJavaScript(
        `window.mochiNative && window.mochiNative.setHidden(${state !== 'active'}); true;`
      );
    });
    return () => {
      sub.remove();
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, []);

  function onMessage(event: WebViewMessageEvent) {
    let msg: { type?: string; on?: boolean; name?: string };
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === 'awake') {
      if (msg.on) activateKeepAwake(KEEP_AWAKE_TAG);
      else deactivateKeepAwake(KEEP_AWAKE_TAG);
    }
    if (msg.type === 'haptic' && msg.name) HAPTICS[msg.name]?.().catch(() => {});
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={web}
        // a real base URL gives the page an origin, so its saved progress (localStorage) persists
        source={{ html: MOCHI_HTML, baseUrl: 'https://mochi.farm/' }}
        originWhitelist={['*']}
        onMessage={onMessage}
        // fill the whole screen edge to edge; the page pads itself around the notch and home bar
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        // behave like an app, not a web page: no bouncing, zooming, scrollbars or link previews
        bounces={false}
        overScrollMode="never"
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        allowsLinkPreview={false}
        dataDetectorTypes="none"
        textZoom={100}
        setBuiltInZoomControls={false}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        style={styles.web}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3E4C4',
  },
  web: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
