import { Fragment, type ReactNode } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import type { NoticeDetail, NoticeMediaItem } from './notice-api';

type Node = {
  type: string;
  text?: string;
  attrs?: { src?: string; alt?: string; level?: number };
  content?: Node[];
  marks?: { type: string; attrs?: { href?: string } }[];
};

function webAddress(value?: string) {
  try {
    const url = new URL(value || '');
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function NoticeBody({notice, photo, onLinkError}: {
  notice: NoticeDetail;
  photo: (item: NoticeMediaItem) => ReactNode;
  onLinkError: () => void;
}) {
  const placed = new Set<string>();
  const link = (label: string, url: string, key: number) =>
    <Text key={key} accessibilityRole="link" style={styles.link}
      onPress={() => { void Linking.openURL(url).catch(onLinkError); }}>{label}</Text>;

  function linkedText(value: string) {
    return value.split(/(https?:\/\/[^\s<>"']+)/gi).map((part, i) => {
      const label = part.replace(/[.,!?;:]+$/, '').replace(/\)$/, tail =>
        part.split(')').length > part.split('(').length ? '' : tail);
      const href = webAddress(label);
      return href ? <Fragment key={i}>{link(label, href, i)}{part.slice(label.length)}</Fragment> : part;
    });
  }

  function draw(node: Node, depth = 0): ReactNode {
    if (!node || depth > 30) return null;
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'text') {
      const value = String(node.text || '');
      const marks = Array.isArray(node.marks) ? node.marks : [];
      const href = webAddress(marks.find(mark => mark?.type === 'link')?.attrs?.href);
      return <Text style={{fontWeight: marks.some(m => m?.type === 'bold') ? 'bold' : undefined,
        fontStyle: marks.some(m => m?.type === 'italic') ? 'italic' : undefined,
        textDecorationLine: marks.some(m => m?.type === 'underline') ? 'underline' : marks.some(m => m?.type === 'strike') ? 'line-through' : undefined}}>
        {href ? link(value, href, 0) : linkedText(value)}</Text>;
    }
    if (node.type === 'image') {
      const item = notice.media.find(entry =>
        (entry.storage_path.match(/([0-9a-f-]{36})\.[a-z]+$/i)?.[1] || entry.id) === node.attrs?.src);
      if (!item) return null;
      placed.add(item.id);
      return <View>{photo(item)}{node.attrs?.alt ? <Text>{node.attrs.alt}</Text> : null}</View>;
    }
    const children = Array.isArray(node.content) ? node.content : [];
    const content = children.map((child, i) => <Fragment key={i}>{draw(child, depth + 1)}</Fragment>);
    if (node.type === 'paragraph' || node.type === 'heading')
      return <Text style={[styles.body, node.type === 'heading' && styles.heading]}>{content}</Text>;
    if (node.type === 'orderedList' || node.type === 'bulletList')
      return <View>{content.map((child, i) => <View style={styles.row} key={i}><Text>{node.type === 'bulletList' ? '•' : (i+1)+'.'}</Text><View style={styles.flex}>{child}</View></View>)}</View>;
    return <View style={node.type === 'blockquote' ? styles.quote : styles.blocks}>{content}</View>;
  }

  let content: ReactNode = <Text style={styles.body}>{linkedText(notice.body_easy)}</Text>;
  const prefix = 'TAEJANG_ARTICLE_V1\n';
  if (notice.body_document?.startsWith(prefix) && notice.body_document.length <= 30000) {
    try {
      const root = JSON.parse(notice.body_document.slice(prefix.length));
      if (root?.type === 'doc' && Array.isArray(root.content)) content = draw(root);
    } catch { placed.clear(); }
  }
  return <View style={styles.blocks}>{content}
    {notice.media.filter(item => !placed.has(item.id)).map(item => <Fragment key={item.id}>{photo(item)}</Fragment>)}
    {webAddress(notice.related_link_url || '') ? link(notice.related_link_label || '관련 링크', webAddress(notice.related_link_url!), -1) : null}
  </View>;
}

const styles = StyleSheet.create({
  body: {color:'#344b40',fontSize:17,lineHeight:27},
  heading: {fontSize:21,fontWeight:'bold'},
  blocks: {gap:10}, row: {flexDirection:'row',gap:8}, flex:{flex:1},
  link: {color:'#165a86',textDecorationLine:'underline'},
  quote: {paddingLeft:12,borderLeftWidth:3,borderColor:'#62816e'},
});
