// 공부 탭 자료구조와 알고리즘(algo.html) 문제 원본 — 기말고사 프린트 코드.
// node scripts/build-algo.mjs 가 각 테스트 입력을 정답 코드로 돌려(Compiler Explorer) 기대 출력을 만들고
// algo.html 의 BUILTIN 에 넣는다. 문제를 고치면 이 파일을 고치고 다시 실행한다.
//
// 빈칸 문법 (중간고사 웹과 같음)
//   @@@begin            블록 빈칸: 다음 줄들 = 안내(영어, 한 줄에 하나), @@@code 뒤 = 정답 코드, @@@end
//   @@@fn 이름 / @@@fn! 이름   함수별 On/Off 칸 (! 는 처음에 Off = 직접 구현)
//   @@정답@@            한 줄 빈칸
// tests: [{ in }] — out 은 build-algo.mjs 가 채운다.

const P = "박지훈T 프린트", G = "이가연T 코드";

export const PROBLEMS = [
  // ───────── 힙 ─────────
  {
    id: "heap-max", cat: "힙", level: 2, src: P, title: "최대 힙 (배열로 구현)",
    desc: "배열 heap[1..hn] 으로 최대 힙을 만든다. 자연수 x 가 들어오면 넣고(push), 0 이 들어오면 가장 큰 값을 빼서 출력한다(pop, 비어 있으면 0).\n부모 i/2 · 왼쪽 자식 i*2 · 오른쪽 자식 i*2+1\n입력: 연산 수 t, 다음 t줄에 x / 출력: 0 이 들어올 때마다 한 줄",
    tests: [
      { in: "13\n0\n1\n2\n0\n0\n3\n2\n1\n0\n0\n0\n0\n0\n" },
      { in: "12\n5\n9\n3\n7\n0\n0\n8\n1\n0\n0\n0\n0\n" },
    ],
    code: `#include <bits/stdc++.h>
using namespace std;
int heap[100001], hn;
int pop(){
@@@fn! pop
Save the root \`heap[1]\` (the maximum) in \`ans\`
Move the last value \`heap[hn]\` to the root, then clear the last slot and decrease \`hn\` (\`heap[hn--] = 0\`)
Sift down from \`i = 1\` while a left child exists (\`i*2 <= hn\`): stop if \`heap[i]\` is bigger than both children
Otherwise swap with the bigger child (left \`i*2\` or right \`i*2+1\`) and move \`i\` to that child
Return \`ans\`
@@@code
    int ans = heap[1];
    heap[1] = heap[hn];
    heap[hn--] = 0;
    for(int i=1;i*2<=hn;){
        if(heap[i]>heap[i*2] && heap[i]>heap[i*2+1]){
            break;
        }else if(heap[i*2]>heap[i*2+1]){
            swap(heap[i],heap[i*2]);
            i=i*2;
        }else{
            swap(heap[i],heap[i*2+1]);
            i=i*2+1;
        }
    }
    return ans;
@@@end
}
void push(int x){
@@@fn! push
Increase \`hn\` first, then put \`x\` at the last position (\`heap[++hn] = x\`)
Sift up from \`i = hn\` toward the root (\`i > 1\`, \`i /= 2\`): if the parent \`heap[i/2]\` is smaller, swap; otherwise stop
@@@code
    heap[++hn]=x;
    for(int i=hn;i>1;i/=2){
        if(heap[i/2]<heap[i]) swap(heap[i/2],heap[i]);
        else break;
    }
@@@end
}
int main(){
    int t;
    cin >> t;
    while(t--){
        int x;
        cin >> x;
        if(x == 0){
            if(hn == 0) cout << 0 << "\\n";
            else cout << pop() << "\\n";
        }else push(x);
    }
}
`,
  },

  // ───────── Union-Find ─────────
  {
    id: "union-find", cat: "Union-Find", level: 1, src: P, title: "Union-Find (경로 압축)",
    desc: "parent[i] 로 집합을 나타낸다. 루트는 parent[x] == x. Find 는 루트를 찾으면서 거쳐 간 노드를 루트에 바로 붙이고(경로 압축), Union 은 y 쪽 루트를 x 쪽 루트 밑에 붙인다.\nmain 은 프린트 그대로: Union(1,2) · Union(4,5) · Union(5,6) 뒤 parent 를 출력하고, Union(1,4) 전후로 2와 4가 같은 집합인지 출력한다.\n입력 없음",
    tests: [{ in: "" }],
    code: `#include <bits/stdc++.h>
using namespace std;
int parent[8];
int Find(int x){
@@@fn! Find
If \`x\` is its own parent, it is the root: return \`x\`
Otherwise find the root of \`parent[x]\` recursively, store it in \`parent[x]\` (path compression) and return it — all in one line
@@@code
    if(x==parent[x]) return x;
    else return parent[x]=Find(parent[x]);
@@@end
}
void Union(int x,int y){
@@@fn! Union
Replace \`x\` and \`y\` with their roots
If the roots are the same they are already in one set: return
Otherwise attach the root of \`y\` under the root of \`x\`
@@@code
    x=Find(x);
    y=Find(y);
    if(x==y) return;
    parent[y]=x;
@@@end
}
bool isUnion(int x,int y){
@@@fn isUnion
Return whether \`x\` and \`y\` have the same root
@@@code
    x=Find(x);
    y=Find(y);
    return x==y;
@@@end
}
int main(){
    for(int i=1;i<=7;i++) parent[i]=i;
    Union(1,2);
    Union(4,5);
    Union(5,6);
    for(int i=1;i<=7;i++){
        cout << parent[i] << "\\n";
    }
    cout << "2와 4는 같은 집합인가? " << isUnion(2,4) << "\\n";
    Union(1,4);
    cout << "2와 4는 같은 집합인가? " << isUnion(2,4) << "\\n";
}
`,
  },

  // ───────── 트리 ─────────
  {
    id: "tree-level", cat: "트리", level: 1, src: P, title: "완전이진트리 레벨별 출력",
    desc: "완전이진트리를 배열 T[1..n] 에 넣었을 때 같은 깊이(레벨)의 노드를 한 줄씩 출력한다. 레벨 k 의 첫 번호는 1, 2, 4, 8 … 이고 그 레벨의 마지막 번호는 2*k-1.\n입력: n, 다음 줄에 n개의 수 / 출력: 레벨마다 한 줄 (수 뒤에 공백)",
    tests: [{ in: "7\n1 2 3 4 5 6 7\n" }, { in: "10\n9 4 7 1 3 6 2 8 5 10\n" }],
    code: `#include <cstdio>
int n, T[1<<10];

int main( )
{
  scanf("%d", &n);
  for(int i=1; i<=n; i++)
      scanf("%d", &T[i]);

@@@begin
Loop over the first index of each level: \`k = 1, 2, 4, 8, ...\` while \`k <= n\`
For each level print \`T[i]\` for \`i = k ... 2*k-1\` (but not past \`n\`) with \`printf("%d ", T[i])\`, then a newline
@@@code
  for(int k=1; k<=n; k*=2){
      for(int i=k; i<=n&&i<=2*k-1; i++)
          printf("%d ", T[i]);
      printf("\\n");
  }
@@@end
}
`,
  },
  {
    id: "tree-order", cat: "트리", level: 2, src: P, title: "트리 순회 (전위 · 중위 · 후위)",
    desc: "노드 A, B, C … 를 0, 1, 2 … 로 바꿔 a[x][0] = 왼쪽 자식, a[x][1] = 오른쪽 자식(없으면 -1)에 저장하고, A 에서 시작해 전위 · 중위 · 후위 순회 결과를 출력한다.\n전위 Root-L-R · 중위 L-Root-R · 후위 L-R-Root\n입력: n, 다음 n줄에 노드 왼쪽 오른쪽 (없으면 .) / 출력: 세 줄",
    tests: [
      { in: "7\nA B C\nB D .\nC E F\nE . .\nF . G\nD . .\nG . .\n" },
      { in: "8\nA B E\nB C .\nC . D\nD . .\nE F G\nF . .\nG H .\nH . .\n" },
    ],
    code: `#include <iostream>
using namespace std;
int a[50][2];
void preorder(int x) {
@@@fn! preorder
If \`x == -1\` (no node) return
Print the node as a letter \`(char)(x+'A')\`, then visit the left child \`a[x][0]\` and the right child \`a[x][1]\`
@@@code
    if (x == -1) return;
    cout << (char)(x+'A');
    preorder(a[x][0]);
    preorder(a[x][1]);
@@@end
}
void inorder(int x) {
@@@fn! inorder
If \`x == -1\` return
Visit the left child, print the node, then visit the right child
@@@code
    if (x == -1) return;
    inorder(a[x][0]);
    cout << (char)(x+'A');
    inorder(a[x][1]);
@@@end
}
void postorder(int x) {
@@@fn! postorder
If \`x == -1\` return
Visit the left child, visit the right child, then print the node
@@@code
    if (x == -1) return;
    postorder(a[x][0]);
    postorder(a[x][1]);
    cout << (char)(x+'A');
@@@end
}
int main() {
    int n;
    cin >> n;
    for (int i=1; i<=n; i++) {
        char x, y, z;
        cin >> x >> y >> z;
@@@begin
Turn the letter \`x\` into a number (\`x = x-'A'\`)
Store the left child \`y\` in \`a[x][0]\` and the right child \`z\` in \`a[x][1]\` as numbers; if the child is \`'.'\` store \`-1\`
@@@code
        x = x-'A';
        if (y == '.') {
            a[x][0] = -1;
        } else {
            a[x][0] = y-'A';
        }
        if (z == '.') {
            a[x][1] = -1;
        } else {
            a[x][1] = z-'A';
        }
@@@end
    }
    preorder(0);
    cout << '\\n';
    inorder(0);
    cout << '\\n';
    postorder(0);
    cout << '\\n';
    return 0;
}
`,
  },

  // ───────── MST ─────────
  {
    id: "mst-prim", cat: "MST", level: 2, src: P, title: "프림 (Prim)",
    desc: "1번 정점에서 시작해, 트리와 맞닿은 간선 중 가장 가벼운 것으로 아직 트리에 없는 정점을 하나씩 붙인다. priority_queue 는 큰 값이 먼저 나오므로 가중치에 - 를 붙여 넣는다 (pair 의 first = -가중치, second = 정점).\n입력: 정점 수 n, 간선 수 m, 다음 m줄에 a b c (무방향) / 출력: 최소 신장 트리의 가중치 합",
    tests: [
      { in: "6\n9\n1 2 5\n1 3 4\n2 3 2\n2 4 7\n3 4 6\n3 5 11\n4 5 3\n4 6 8\n5 6 8\n" },
      { in: "7 11\n1 2 3\n1 4 6\n1 3 17\n2 4 5\n2 7 12\n3 5 10\n3 6 8\n4 5 9\n5 6 4\n5 7 2\n6 7 14\n" },
    ],
    code: `#include<iostream>
#include<vector>
#include<queue>
using namespace std;
// 최대 정점의 수
#define MAX 10001
// 그래프 방문표시 배열
bool check[MAX] = {false,};
// 그래프의 인접 리스트(연결된 정점 번호, 간선 가중치)쌍
vector<pair<int,int>> mArr[MAX];

void prim(){
    check[1] = true; //1번부터 시작

    // 우선순위 큐
    priority_queue<pair<int,int>> q;
@@@begin
Push every edge of vertex 1 into \`q\` as \`make_pair(-weight, vertex)\` (\`mArr[1]\` holds \`(vertex, weight)\` pairs)
@@@code
    for(auto p: mArr[1]){
        q.push(make_pair(-p.second, p.first));
    }
@@@end
    //MST 최소의 합 저장 변수
    int answer = 0;

@@@begin
While \`q\` is not empty, take out the lightest edge (\`top\`, then \`pop\`)
If its end vertex \`p.second\` is not visited yet: mark it, add the weight \`-p.first\` to \`answer\`, and push all edges of that vertex the same way
@@@code
    while(!q.empty()){
        pair<int,int> p = q.top();
        q.pop();
        //끝점이 방문된 점이 있지 않은 경우
        if(!check[p.second]){
            //방문표시
            check[p.second] = true;
            //최소값의 합 덧셈
            answer+= -p.first;

            int x = p.second;
            for(pair<int,int> p : mArr[x]){
                q.push(make_pair(-p.second, p.first));
            }
        }
    }
@@@end
    cout<<answer<<'\\n';
}

int main(){
    int n=0, m=0;
    cin>>n>>m;
    for(int i=1; i<=m; i++){
        int a=0, b=0, c=0;
        cin>>a>>b>>c;
        mArr[a].push_back(make_pair(b,c));
        mArr[b].push_back(make_pair(a,c));
    }
    prim();
    return 0;
}
`,
  },
  {
    id: "mst-kruskal", cat: "MST", level: 3, src: P, title: "크루스칼 (Kruskal)",
    desc: "간선을 가중치 오름차순으로 정렬하고, 가벼운 간선부터 두 끝점이 다른 집합(사이클이 안 생김)이면 채택한다. 사이클 검사는 Union-Find (경로 압축 + 랭크 기준 합치기). V-1 개를 채택하면 끝.\n입력: V E, 다음 E줄에 u v w / 출력: 최소 신장 트리의 가중치 합",
    tests: [
      { in: "6 9\n1 2 5\n1 3 4\n2 3 2\n2 4 7\n3 4 6\n3 5 11\n4 5 3\n4 6 8\n5 6 8\n" },
      { in: "7 11\n1 2 3\n1 4 6\n1 3 17\n2 4 5\n2 7 12\n3 5 10\n3 6 8\n4 5 9\n5 6 4\n5 7 2\n6 7 14\n" },
    ],
    code: `#include <iostream>
#include <vector>
#include <algorithm>
#include <numeric>
using namespace std;

struct Edge {
    int u, v;
    long long w;
    bool operator<(const Edge& other) const { return w < other.w; }
};

// ---------------- 유니온 파인드 ----------------
struct UnionFind {
    vector<int> parent; // parent[x]: x의 부모. 루트는 자기 자신
    vector<int> rnk;    // 트리 높이의 상한(랭크)

    explicit UnionFind(int n) : parent(n + 1), rnk(n + 1, 0) {
        iota(parent.begin(), parent.end(), 0); // parent[i] = i
    }

    // 경로 압축: 루트를 찾으면서 거쳐 간 노드를 모두 루트에 직접 연결
    int find(int x) {
@@@fn! find
If \`parent[x]\` is not \`x\`, set \`parent[x]\` to the root found recursively (path compression)
Return \`parent[x]\`
@@@code
        if (parent[x] != x) parent[x] = find(parent[x]);
        return parent[x];
@@@end
    }

    // 랭크 기준 합치기. 이미 같은 집합이면 false(사이클), 합쳤으면 true
    bool unite(int a, int b) {
@@@fn! unite
Replace \`a\`, \`b\` with their roots; if they are equal return \`false\` (cycle)
Make \`a\` the root with the larger rank (swap if \`rnk[a] < rnk[b]\`), then attach \`b\` under \`a\`
If the ranks were equal, increase \`rnk[a]\`; return \`true\`
@@@code
        a = find(a);
        b = find(b);
        if (a == b) return false;
        if (rnk[a] < rnk[b]) swap(a, b);
        parent[b] = a;
        if (rnk[a] == rnk[b]) rnk[a]++;
        return true;
@@@end
    }
};

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int V, E;
    cin >> V >> E;

    vector<Edge> edges(E);
    for (auto& e : edges) cin >> e.u >> e.v >> e.w;

@@@begin
1) Sort \`edges\` by weight (ascending)
2) Make \`UnionFind uf(V)\`; go through the edges from the lightest and take an edge if \`uf.unite(e.u, e.v)\` succeeds, adding \`e.w\` to \`total\` (\`long long\`)
3) Count the taken edges in \`picked\` and stop when \`picked == V - 1\`
@@@code
    // 1) 가중치 오름차순 정렬
    sort(edges.begin(), edges.end());

    // 2) 가벼운 간선부터 보면서, 다른 집합이면 채택
    UnionFind uf(V);
    long long total = 0;
    int picked = 0;
    for (const Edge& e : edges) {
        if (uf.unite(e.u, e.v)) {
            total += e.w;
            if (++picked == V - 1) break; // 3) V-1개 채택하면 완성
        }
    }
@@@end

    cout << total << "\\n";
    return 0;
}
`,
  },

  // ───────── 위상정렬 ─────────
  {
    id: "topo-line", cat: "위상정렬", level: 2, src: P, title: "줄 세우기 (위상정렬)",
    desc: "x 가 y 앞에 서야 한다는 비교 m개로 학생 n명을 줄 세운다. ind[y] = y 앞에 와야 하는 사람 수(진입 차수). 진입 차수가 0인 사람을 큐에 넣고, 꺼낼 때마다 출력하고 그 뒤 사람들의 진입 차수를 줄인다.\n입력: n m, 다음 m줄에 x y / 출력: 줄 선 순서 (수 뒤에 공백)",
    tests: [{ in: "3 2\n1 3\n2 3\n" }, { in: "4 2\n4 2\n3 1\n" }, { in: "6 6\n1 2\n1 3\n2 4\n3 4\n4 5\n6 5\n" }],
    code: `#include <cstdio>
#include <vector>
#include <queue>
using namespace std;
vector<int> a[32001];
int ind[32001];
int main() {
    int n,m;
    scanf("%d %d",&n,&m);
    for (int i=0; i<m; i++) {
        int x,y;
        scanf("%d %d",&x,&y);
@@@begin
Store the edge \`x → y\` in the adjacency list and increase the in-degree of \`y\`
@@@code
        a[x].push_back(y);
        ind[y] += 1;
@@@end
    }
    queue<int> q;
@@@begin
Push every vertex \`1..n\` whose in-degree is 0 into \`q\`
Repeat \`n\` times: take \`x\` from the front, print it (\`printf("%d ",x)\`), decrease the in-degree of every \`y\` in \`a[x]\` and push \`y\` when it becomes 0
@@@code
    for (int i=1; i<=n; i++) {
        if (ind[i] == 0) {
            q.push(i);
        }
    }
    for (int k=0; k<n; k++) {
        int x = q.front();
        q.pop();
        printf("%d ",x);
        for (int i=0; i<a[x].size(); i++) {
            int y = a[x][i];
            ind[y] -= 1;
            if (ind[y] == 0) {
                q.push(y);
            }
        }
    }
@@@end
    printf("\\n");
    return 0;
}
`,
  },
  {
    id: "topo-pq", cat: "위상정렬", level: 2, src: P, title: "문제집 (위상정렬 + 우선순위 큐)",
    desc: "줄 세우기와 같지만, 풀 수 있는 문제가 여러 개면 번호가 작은 것부터 푼다. priority_queue 는 큰 값이 먼저 나오므로 -번호를 넣는다.\n입력: n m, 다음 m줄에 x y (x 를 y 보다 먼저) / 출력: 푸는 순서 (수 뒤에 공백)",
    tests: [{ in: "4 2\n4 2\n3 1\n" }, { in: "6 5\n6 1\n5 1\n4 2\n3 2\n2 1\n" }],
    code: `#include <cstdio>
#include <vector>
#include <queue>
using namespace std;
vector<int> a[32001];
int ind[32001];
int main() {
    int n,m;
    scanf("%d %d",&n,&m);
    for (int i=0; i<m; i++) {
        int x,y;
        scanf("%d %d",&x,&y);
        a[x].push_back(y);
        ind[y] += 1;
    }
@@@begin
Use \`priority_queue<int> q\`, and push \`-i\` (not \`i\`) so that the smallest number comes out first
Push every vertex with in-degree 0; then repeat \`n\` times: take \`x = -q.top()\`, pop, print it, and decrease the in-degree of each next vertex \`y\`, pushing \`-y\` when it becomes 0
@@@code
    priority_queue<int> q;
    for (int i=1; i<=n; i++) {
        if (ind[i] == 0) {
            q.push(-i);
        }
    }
    for (int k=0; k<n; k++) {
        int x = -q.top();
        q.pop();
        printf("%d ",x);
        for (int i=0; i<a[x].size(); i++) {
            int y = a[x][i];
            ind[y] -= 1;
            if (ind[y] == 0) {
                q.push(-y);
            }
        }
    }
@@@end
    printf("\\n");
    return 0;
}
`,
  },
  {
    id: "topo-work", cat: "위상정렬", level: 3, src: P, title: "작업 (위상정렬) ★시험에 낸다고 하심",
    desc: "작업 i 는 work[i] 시간이 걸리고, 먼저 끝나야 하는 작업들이 있다. 동시에 여러 작업을 할 수 있을 때 모든 작업을 끝내는 최소 시간을 구한다. d[i] = 작업 i 가 끝나는 가장 이른 시각 = (앞선 작업들의 d 중 최댓값) + work[i].\n입력: n, 다음 n줄에 시간 · 앞선 작업 수 cnt · 앞선 작업 번호 cnt개 / 출력: 최소 시간",
    tests: [
      { in: "7\n5 0\n1 1 1\n3 1 2\n6 1 1\n1 2 2 4\n8 2 2 4\n4 3 3 5 6\n" },
      { in: "5\n3 0\n2 0\n4 1 1\n1 2 1 2\n5 2 3 4\n" },
    ],
    code: `#include <cstdio>
#include <vector>
#include <queue>
using namespace std;
vector<int> a[10001];
int ind[10001];
int work[10001];
int d[10001];
int main() {
    int n;
    scanf("%d",&n);
    for (int i=1; i<=n; i++) {
        scanf("%d",&work[i]);
        int cnt;
        scanf("%d",&cnt);
@@@begin
Read the \`cnt\` earlier tasks \`x\`; for each one store the edge \`x → i\` and increase the in-degree of \`i\`
@@@code
        for (int j=0; j<cnt; j++) {
            int x;
            scanf("%d",&x);
            a[x].push_back(i);
            ind[i] += 1;
        }
@@@end
    }
    queue<int> q;
@@@begin
Push every task with in-degree 0 and set its finish time \`d[i] = work[i]\`
Repeat \`n\` times: take \`x\`; for each next task \`y\` decrease its in-degree, update \`d[y]\` to \`d[x]+work[y]\` if that is larger, and push \`y\` when its in-degree becomes 0
@@@code
    for (int i=1; i<=n; i++) {
        if (ind[i] == 0) {
            q.push(i);
            d[i] = work[i];
        }
    }
    for (int k=0; k<n; k++) {
        int x = q.front();
        q.pop();
        for (int i=0; i<a[x].size(); i++) {
            int y = a[x][i];
            ind[y] -= 1;
            if (d[y] < d[x]+work[y]) {
                d[y] = d[x]+work[y];
            }
            if (ind[y] == 0) {
                q.push(y);
            }
        }
    }
@@@end
@@@begin
The answer is the largest \`d[i]\`; print it with \`printf("%d\\n",ans)\`
@@@code
    int ans = 0;
    for (int i=1; i<=n; i++) {
        if (ans < d[i]) {
            ans = d[i];
        }
    }
    printf("%d\\n",ans);
@@@end
    return 0;
}
`,
  },

  // ───────── 최단거리 ─────────
  {
    id: "sp-dijkstra", cat: "최단거리", level: 2, src: P, title: "최소비용 구하기 (다익스트라)",
    desc: "버스(방향 간선)로 start 에서 end 까지 가는 최소 비용. 아직 확정되지 않은 정점 중 dist 가 가장 작은 x 를 골라 확정하고(check), x 에서 나가는 간선으로 dist 를 줄인다. 이것을 n-1 번 한다 (O(n^2)).\n입력: n, m, 다음 m줄에 x y z, 마지막 줄에 start end / 출력: 최소 비용",
    tests: [
      { in: "5\n8\n1 2 2\n1 3 3\n1 4 1\n1 5 10\n2 4 2\n3 4 1\n3 5 1\n4 5 3\n1 5\n" },
      { in: "4\n5\n1 2 7\n1 3 2\n3 2 3\n2 4 1\n3 4 9\n1 4\n" },
    ],
    code: `#include <cstdio>
#include <vector>
using namespace std;
struct Edge {
    int to;
    int cost;
    Edge(int to, int cost) : to(to), cost(cost) {
    }
};
vector<Edge> a[1001];
int dist[1001];
bool check[1001];
int inf = 1000000000;
int main() {
    int n;
    scanf("%d",&n);
    int m;
    scanf("%d",&m);
    for (int i=0; i<m; i++) {
        int x,y,z;
        scanf("%d %d %d",&x,&y,&z);
        a[x].push_back(Edge(y,z));
    }
    int start, end;
    scanf("%d %d",&start,&end);
@@@begin
Set every \`dist[i]\` to \`inf\` and \`dist[start]\` to 0
@@@code
    for (int i=1; i<=n; i++) {
        dist[i] = inf; //거리 inf로 초기화
    }
    dist[start] = 0; //시작점의 거리 0으로 초기화
@@@end
@@@begin
Repeat \`n-1\` times:
Find the unchecked vertex \`x\` with the smallest \`dist\` (start with \`m = inf+1\`, \`x = -1\`) and mark it checked
For every edge \`x → y\` with cost \`a[x][i].cost\`, lower \`dist[y]\` if going through \`x\` is cheaper
@@@code
    for (int k=0; k<n-1; k++) {
        int m = inf+1;
        int x = -1;
        for (int i=1; i<=n; i++) { //최소값 찾는 과정
            if (check[i] == false && m > dist[i]) {
                m = dist[i];
                x = i;
            }
        }
        check[x] = true;
        //x와 연결되어 있는 모든 간선을 갱신
        for (int i=0; i<a[x].size(); i++) {
            int y = a[x][i].to;
            if (dist[y] > dist[x] + a[x][i].cost) {
                dist[y] = dist[x] + a[x][i].cost;
            }
        }
    }
@@@end
    printf("%d\\n",dist[end]);
    return 0;
}
`,
  },
  {
    id: "sp-dijkstra-path", cat: "최단거리", level: 3, src: P, title: "최소비용 구하기 2 (다익스트라 · 경로 출력)",
    desc: "다익스트라에 from[y] = (y 로 오기 직전 정점)을 더해 경로를 복원한다. end 에서 from 을 따라 start 까지 거슬러 올라가며 stack 에 쌓았다가 꺼내면 start → end 순서가 된다.\n입력: 최소비용 구하기와 같음 / 출력: 최소 비용, 경로의 정점 수, 경로 (수 뒤에 공백)",
    tests: [
      { in: "5\n8\n1 2 2\n1 3 3\n1 4 1\n1 5 10\n2 4 2\n3 4 1\n3 5 1\n4 5 3\n1 5\n" },
      { in: "4\n5\n1 2 7\n1 3 2\n3 2 3\n2 4 1\n3 4 9\n1 4\n" },
    ],
    code: `#include <cstdio>
#include <stack>
#include <vector>
using namespace std;
struct Edge {
    int to;
    int cost;
    Edge(int to, int cost) : to(to), cost(cost) {
    }
};
vector<Edge> a[1001];
int dist[1001];
bool check[1001];
int from[1001];
int inf = 1000000000;
int main() {
    int n;
    scanf("%d",&n);
    int m;
    scanf("%d",&m);
    for (int i=0; i<m; i++) {
        int x,y,z;
        scanf("%d %d %d",&x,&y,&z);
        a[x].push_back(Edge(y,z));
    }
    int start, end;
    scanf("%d %d",&start,&end);
    for (int i=1; i<=n; i++) {
        dist[i] = inf;
    }
    dist[start] = 0;
    from[start] = -1;
    for (int k=0; k<n-1; k++) {
        int m = inf+1;
        int x = -1;
        for (int i=1; i<=n; i++) {
            if (check[i] == false && m > dist[i]) {
                m = dist[i];
                x = i;
            }
        }
        check[x] = true;
        for (int i=0; i<a[x].size(); i++) {
            int y = a[x][i].to;
@@@begin
If going through \`x\` is cheaper, lower \`dist[y]\` and remember that \`y\` was reached from \`x\` (\`from[y] = x\`)
@@@code
            if (dist[y] > dist[x] + a[x][i].cost) {
                dist[y] = dist[x] + a[x][i].cost;
                from[y] = x;
            }
@@@end
        }
    }
    printf("%d\\n",dist[end]);
@@@begin
Walk back from \`end\` following \`from\` until \`-1\`, pushing each vertex into \`stack<int> st\`
Print the number of vertices (\`st.size()\`) on one line, then pop and print them with \`printf("%d ", ...)\`, then a newline
@@@code
    stack<int> st;
    int x = end;
    while (x != -1) {
        st.push(x);
        x = from[x];
    }
    printf("%d\\n",st.size());
    while (!st.empty()) {
        printf("%d ",st.top());
        st.pop();
    }
    printf("\\n");
@@@end
    return 0;
}
`,
  },
  {
    id: "sp-timemachine", cat: "최단거리", level: 3, src: P, title: "타임머신 (벨만포드)",
    desc: "음수 간선이 있을 때 1번에서 다른 정점까지의 최단 거리. 모든 간선으로 dist 를 줄이는 것을 n 번 반복하는데, n 번째에도 줄어들면 음수 사이클이 있다는 뜻이다. dist[x] == inf 인(아직 못 간) 정점에서 나가는 간선은 쓰지 않는다.\n입력: n m, 다음 m줄에 from to cost / 출력: 음수 사이클이면 -1, 아니면 2..n 번까지 거리 (못 가면 -1)",
    tests: [
      { in: "3 4\n1 2 4\n1 3 3\n2 3 -1\n3 1 -2\n" },
      { in: "3 4\n1 2 4\n1 3 3\n2 3 -4\n3 1 -2\n" },
      { in: "3 2\n1 2 4\n1 2 3\n" },
    ],
    code: `#include <cstdio>
#include <vector>
using namespace std;
struct Edge {
    int from;
    int to;
    int cost;
};
int dist[501];
int inf = 100000000;
int main() {
    int t;
    int n,m;
    scanf("%d %d",&n,&m);
    vector<Edge> a(m);
    for (int i=0; i<m; i++) {
        scanf("%d %d %d",&a[i].from, &a[i].to, &a[i].cost);
    }
    for (int i=1; i<=n; i++) {
        dist[i] = inf;
    }
    dist[1] = 0;
    bool negative_cycle = false;
@@@begin
Repeat \`i = 1..n\`; in each round go through every edge \`x → y\` with cost \`z\`
If \`dist[x] != inf\` and \`dist[y] > dist[x]+z\`, update \`dist[y]\`; if this happens in round \`n\`, set \`negative_cycle = true\`
@@@code
    for (int i=1; i<=n; i++) {
        for (int j=0; j<m; j++) {
            int x = a[j].from;
            int y = a[j].to;
            int z = a[j].cost;
            if (dist[x] != inf && dist[y] > dist[x]+z) {
                dist[y] = dist[x]+z;
                if (i == n) {
                    negative_cycle = true;
                }
            }
        }
    }
@@@end
@@@begin
If there is a negative cycle print \`-1\`
Otherwise print \`dist[2..n]\` one per line, printing \`-1\` for an unreachable vertex (\`dist == inf\`)
@@@code
    if (negative_cycle) {
        printf("-1\\n");
    } else {
        for (int i=2; i<=n; i++) {
            if (dist[i] == inf) dist[i] = -1;
            printf("%d\\n",dist[i]);
        }
    }
@@@end
    return 0;
}
`,
  },
  {
    id: "sp-wormhole", cat: "최단거리", level: 3, src: P, title: "웜홀 (벨만포드)",
    desc: "도로(양방향, 양수)와 웜홀(한 방향, 시간이 거꾸로 = 음수 가중치)이 있을 때, 출발한 곳으로 돌아와 시간이 줄어드는 경우(음수 사이클)가 있는지 판단한다. 도로는 반대 방향 간선을 하나 더 만들고, 웜홀은 비용에 -1 을 곱한다.\n입력: 테스트 수 t, 각 테스트마다 n m w, m줄 도로 s e t, w줄 웜홀 s e t / 출력: 테스트마다 YES 또는 NO",
    tests: [
      { in: "2\n3 3 1\n1 2 2\n1 3 4\n2 3 1\n3 1 3\n3 2 1\n1 2 3\n2 3 4\n3 1 8\n" },
      { in: "1\n4 3 1\n1 2 5\n2 3 5\n3 4 5\n4 1 20\n" },
    ],
    code: `#include <cstdio>
#include <vector>
using namespace std;
struct Edge {
    int from;
    int to;
    int cost;
};
int d[501];
int inf = 100000000;
int main() {
    int t;
    scanf("%d",&t);
    while (t--) {
        int n,m,w;
        scanf("%d %d %d",&n,&m,&w);
        vector<Edge> a(2*m+w);
@@@begin
Read the \`m\` roads into \`a[0..m-1]\`, and make the reverse road in \`a[i+m]\` (copy, then swap \`from\` and \`to\`)
Read the \`w\` wormholes into \`a[2*m .. 2*m+w-1]\` and multiply their cost by \`-1\`
@@@code
        for (int i=0; i<m; i++) {
            scanf("%d %d %d",&a[i].from, &a[i].to, &a[i].cost);
            a[i+m] = a[i];
            swap(a[i+m].from,a[i+m].to);   // 도로는 양방향
        }
        for (int i=2*m; i<2*m+w; i++) {
            scanf("%d %d %d",&a[i].from, &a[i].to, &a[i].cost);
            a[i].cost *= -1;               // 웜홀은 음수 가중치
        }
@@@end
        for (int i=1; i<=n; i++) {
            d[i] = inf;
        }
        d[1] = 0;
        m = 2*m + w;
        bool ok = false;
@@@begin
Run Bellman-Ford for \`n\` rounds over all \`m\` edges (now \`m = 2*m + w\`), skipping edges whose start has \`d == inf\`
If an update happens in round \`n\`, set \`ok = true\` (negative cycle)
@@@code
        for (int i=1; i<=n; i++) {
            for (int j=0; j<m; j++) {
                int x = a[j].from;
                int y = a[j].to;
                int z = a[j].cost;
                if (d[x] != inf && d[y] > d[x]+z) {
                    d[y] = d[x]+z;
                    if (i == n) ok = true;
                }
            }
        }
@@@end
        if (ok) {
            printf("YES\\n");
        } else {
            printf("NO\\n");
        }
    }
    return 0;
}
`,
  },

  // ───────── 이가연T ─────────
  {
    id: "mushikuizan", cat: "충식산", level: 3, src: G, title: "충식산 (벌레 먹은 곱셈)",
    desc: "곱셈 필산에서 몇 칸이 지워져(*) 있을 때 가능한 피승수 × 승수를 모두 찾는다. 피승수는 모든 경우를 넣어 보고(rec_plicand), 승수는 한 자리 넣을 때마다 부분곱이 맞는지 확인해 안 맞으면 바로 버린다(rec_plier). 수는 오른쪽 자리부터 vec 에 들어간다.\n위쪽에서 직접 구현할 함수를 Off 로 고르면 그 함수가 빈칸이 된다.\n입력: 피승수 · 승수 자릿수 A B, 피승수, 승수, 부분곱 B줄(승수의 오른쪽 자리부터), 곱 / 출력: 해의 개수와 모든 해",
    tests: [
      { in: "3 2\n1**\n**\n*1*\n4**\n***5\n" },
      { in: "3 3\n3*7\n**6\n2***\n6**\n***\n4***2\n" },
    ],
    code: `#include <iostream>
#include <vector>
#include <string>
#include <utility>
using namespace std;

//정수 val가 문자열 str에 정합한가?
bool is_valid(int64_t val, const string& str) {
@@@fn is_valid
Convert \`val\` to a string \`sval\`; the lengths of \`sval\` and \`str\` must be equal
Compare character by character, skipping \`'*'\` in \`str\`; return \`false\` on any mismatch, otherwise \`true\`
@@@code
    //정수 val을 문자열로 변환
    string sval = to_string(val);

    //둘의 길이가 일치해야 함
    if (sval.size() != str.size()) return false;

    //한 문자씩 정합성을 확인함
    for (int i = 0; i < sval.size(); ++i) {
        //□의 값은 신경쓰지 않음
        if (str[i] == '*') continue;

        //일치하지 않는 부분이 있으면
        if (sval[i] != str[i]) return false;
    }
    return true;
@@@end
}

//수v를 문자열str의 오른쪽에서 k번째에 적용했을 때 정합한가?
bool is_valid_sub(int v, int k, const string& str) {
@@@fn is_valid_sub
Take the \`k\`-th character from the right: \`str[str.size() - 1 - k]\`
If it is \`'*'\` return \`true\`; otherwise return whether its digit equals \`v\`
@@@code
    //오른쪽에서 k번째 문자를 얻는다
    char c = str[str.size() - 1 - k];
    //공백일 경우 문제 없음
    if (c == '*') return true;

    int real_val = c - '0';
    //값이 일치하는지 여부를 판단함
    return (v == real_val);
@@@end
}

//□에 넣은 수에서 정수 전체를 복원함
int64_t decode(const vector<int>& vec) {
@@@fn decode
\`vec\` holds the digits from the right (ones first)
Build the number with \`res\` (answer) and \`order\` (1, 10, 100, ...) and return it
@@@code
    int64_t res = 0; //답
    int64_t order = 1; // 1, 10, 100, ...
    for (int v : vec) {
        res += order * v;
        order *= 10;
    }
    return res;
@@@end
}

//충식산 프로그램 클래스
class Mushikuizan {
 private:
    //피승수, 승수, 곱
    string multiplicand_, multiplier_, product_;
    //부분곱
    vector<string> middle_;
    // 답을 나타내는 배열(피승수와 승수 쌍을 저장)
    vector<pair<int64_t, int64_t>> res_;

 public:
    //생성자
    Mushikuizan(const string& multiplicand,
                const string& multiplier,
                const string& product,
                const vector<string>& middle) :
        multiplicand_(multiplicand), multiplier_(multiplier),
        product_(product), middle_(middle) {
    }

    //승수의 □에 수를 넣어 나가는 재귀함수
    //plicand: 피승수에 넣은 수, vec: 승수의 □에 수를 넣은 결과
    void rec_plier(int64_t plicand, vector<int>& vec) {
@@@fn! rec_plier
Base case: when \`vec.size() == multiplier_.size()\`, get \`plier = decode(vec)\`; if \`plicand * plier\` fits \`product_\`, save the pair in \`res_\` (\`emplace_back\`); return
Try \`add = 1..9\` (no 0 in the multiplier): skip if it contradicts \`multiplier_\` at position \`vec.size()\` (\`is_valid_sub\`)
Also skip if \`plicand * add\` does not fit the partial product \`middle_[vec.size()]\`
Otherwise push \`add\`, recurse, then pop it back
@@@code
        // 종료조건: 승수의 모든 □에 수가 들어갔을 때
        if (vec.size() == multiplier_.size()) {
            // 승수를 구한다
            int64_t plier = decode(vec);
            // 곱의 적합성을 확인함
            if (!is_valid(plicand * plier, product_)) return;
            //답을 저장함
            res_.emplace_back(plicand, plier);
            return;
        }

        //새 □에 수를 넣는다(승수에 0은 들어가지 않는 것으로 한다)
        for (int add = 1; add <= 9; ++add) {
            //이미 수가 들어 있어 모순될 경우 건너뛴다
            if (!is_valid_sub(add, vec.size(), multiplier_))
                continue;
            // □에 수 add를 넣어 정합성을 확인한다
            if (!is_valid(plicand * add, middle_[vec.size()]))
                continue;
            // vec에 수 add를 추가해 재귀 호출을 함
            vec.push_back(add);
            rec_plier(plicand, vec);
            vec.pop_back();
        }
@@@end
    }

    //피승수의 □에 수를 넣어 나가는 재귀함수
    // vec: 피승수의 □에 수를 넣은 결과
    void rec_plicand(vector<int>& vec) {
@@@fn! rec_plicand
Base case: when \`vec.size() == multiplicand_.size()\`, start filling the multiplier with an empty \`vector<int> vec2\`: \`rec_plier(decode(vec), vec2)\`; return
Try \`add = 0..9\`: the leftmost digit (\`vec.size() == multiplicand_.size() - 1\`) cannot be 0
Skip if it contradicts \`multiplicand_\` (\`is_valid_sub\`); otherwise push, recurse, pop
@@@code
        //종료 조건? 피승수의 모든 □에 수가 들어갔을 때
        if (vec.size() == multiplicand_.size()) {
            //승수의 □에 수를 넣어나간다
            vector<int> vec2;
            rec_plier(decode(vec), vec2);
            return;
        }

        //새 ㅁ에 수를 넣는다
        for (int add = 0; add <= 9; ++add) {
            //맨 왼쪽에는 0이 들어갈 수 없다
            if (vec.size() == multiplicand_.size() - 1 && add == 0) continue;
            //이미 수가 들어 있어 모순될 경우 건너뛴다
            if (!is_valid_sub(add, vec.size(), multiplicand_))
                continue;
            // vec에 값 add를 넣어 재귀 호출을 한다
            vec.push_back(add);
            rec_plicand(vec);
            vec.pop_back();
        }
@@@end
    }

    //충식산을 푼다(피승수와 승수 쌍을 저장한 배열을 반환함)
    vector<pair<int64_t, int64_t>> solve() {
@@@fn solve
Clear \`res_\`, call \`rec_plicand\` with an empty vector, and return \`res_\`
@@@code
        // 답을 나타내는 배열을 비운다
        res_.clear();
        //피승수의 □에서부터 수를 넣어 나간다
        vector<int> vec; //빈 배열
        rec_plicand(vec);
        return res_;
@@@end
    }
};

int main() {
    //입력
    cout << "Mushikuizan Input: " << endl;
    int A, B; //피승수, 승수 자릿수
    cin >> A >> B;
    string hijou, jou, seki; //피승수, 승수, 곱
    vector<string> middle(B); // 중간부분
    cin >> hijou >> jou;
    for (int i = 0; i < B; ++i) cin >> middle[i];
    cin >> seki;

    // 재귀적으로 푼다
    Mushikuizan mu(hijou, jou, seki, middle);
    const vector<pair<int64_t, int64_t>>& res = mu.solve();

    //해를 출력한다
    cout << "The num of solutions: " << res.size() << endl;
    for (int i = 0; i < res.size(); ++i) {
        cout << i << " th solution: "
             << res[i].first << " * " << res[i].second
             << " = " << res[i].first * res[i].second << endl;
    }
}
`,
  },
  {
    id: "maze", cat: "미로 · 기름", level: 3, src: G, title: "미로 (BFS 최단 경로)",
    desc: "S 에서 G 까지 벽(#)을 피해 가는 최단 경로를 BFS 로 찾는다. nodes[k] = 거리 k 인 칸들, dist = 각 칸의 거리, arrow = 그 칸으로 오기 직전 칸. G 에서 arrow 를 거슬러 올라가며 경로를 o 로 표시한다.\n입력: H W, 다음 H줄에 미로 (S 시작, G 도착, # 벽, . 길) / 출력: 경로를 표시한 미로와 길이 (못 가면 No Path)",
    tests: [
      { in: "5 7\nS.#....\n.##.##.\n...#...\n.#...#.\n...#..G\n" },
      { in: "3 4\nS#..\n.#.#\n.#.G\n" },
    ],
    code: `#include <iostream>
#include <vector>
#include <string>
#include <utility>
using namespace std;

// 「좌표」 타입을 정수값 쌍으로 정의
using Cor = pair<int, int>;

// 상하좌우 이동 정의 (0: 아래, 1: 오른쪽, 2: 위, 3: 왼쪽)
const vector<Cor> DIR = {Cor(1, 0), Cor(0, 1), Cor(-1, 0), Cor(0, -1)};

// 아직 방문하지 않았음을 나타내는 값
const int NOTIN = -1;

// 미로 솔버
// board: 미로의 보드. 칸 (x, y)의 정보는 board[x][y]에서 얻음
// start: 시작 칸 좌표, goal: 도착 칸 좌표
void solve(const vector<string>& board,
           const Cor& start, const Cor& goal) {
    // 보드의 세로, 가로 크기
    int H = board.size(), W = board[0].size();

    // nodes[k] := k 라는 숫자가 적힌 칸들의 집합
    vector<vector<Cor>> nodes;

    // dist[x][y] := 칸 (x, y)에 적히는 숫자
    vector<vector<int>> dist(H, vector<int>(W, NOTIN));

    // arrow[x][y] := 칸 (x, y)에서 시작하는 화살표의 끝 좌표
    vector<vector<Cor>> arrow(H, vector<Cor>(W, Cor(NOTIN, NOTIN)));

    // 시작 칸 정보를 이용하여 탐색 정보 초기화
    nodes.push_back(vector<Cor>(1, start));
    dist[start.first][start.second] = 0;

@@@begin
BFS: repeat while the newest set \`nodes.back()\` is not empty
For each cell in it, look at the 4 neighbours (\`DIR\`); skip cells outside the board, walls \`'#'\`, and cells whose \`dist\` is already set
For a new cell set \`dist = dist[x][y] + 1\`, \`arrow = Cor(x, y)\`, and collect it in \`nex\`; after the loop push \`nex\` into \`nodes\`
@@@code
    // BFS 실행 (가장 최근의 nodes가 비게 될 때까지 반복)
    while (!nodes.back().empty()) {
        // 최신 숫자가 적힌 칸들의 집합
        const vector<Cor>& cur = nodes.back();

        // 최신 칸들에서 한 번에 이동 가능한 칸을 구함
        vector<Cor> nex;
        for (const Cor& cell : cur) {
            // cell의 좌표
            int x = cell.first, y = cell.second;

            // 상하좌우 칸을 차례대로 확인
            for (int direction = 0; direction < 4; ++direction) {
                int nex_x = x + DIR[direction].first;
                int nex_y = y + DIR[direction].second;

                // 새 칸이 보드 밖이면 스킵
                if (nex_x < 0 || nex_x >= H) continue;
                if (nex_y < 0 || nex_y >= W) continue;

                // 벽이면 스킵
                if (board[nex_x][nex_y] == '#') continue;

                // 이미 숫자가 적혀 있으면 스킵
                if (dist[nex_x][nex_y] != NOTIN) continue;

                // 새 칸에 숫자 기록 (cell보다 1 더 길다)
                dist[nex_x][nex_y] = dist[x][y] + 1;
                arrow[nex_x][nex_y] = Cor(x, y);
                nex.push_back(Cor(nex_x, nex_y));
            }
        }

        // 새로 숫자가 적힌 칸들을 nodes에 추가
        nodes.push_back(nex);
    }
@@@end

    // 도달할 수 없는 경우 예외 처리
    if (dist[goal.first][goal.second] == NOTIN) {
        cout << "No Path" << endl;
        return;
    }

@@@begin
Copy \`board\` into \`res\` and start at the goal
While the current cell has an arrow (the start has none), mark it \`'o'\` and move to \`arrow[cur_x][cur_y]\`
@@@code
    // 화살표를 따라 경로 복원 시작
    vector<string> res = board;  // 답을 출력할 보드
    int cur_x = goal.first, cur_y = goal.second;

    // 시작 칸은 화살표가 없음에 주의
    while (arrow[cur_x][cur_y] != Cor(NOTIN, NOTIN)) {
        // 최단 경로를 'o'로 표시
        res[cur_x][cur_y] = 'o';

        // 화살표 거슬러 올라가기
        int nex_x = arrow[cur_x][cur_y].first;
        int nex_y = arrow[cur_x][cur_y].second;
        cur_x = nex_x, cur_y = nex_y;
    }
@@@end

    // 최단 경로 출력
    cout << "----- solution -----" << endl;
    for (const string& str : res) cout << str << endl;
    cout << "length = " << dist[goal.first][goal.second] << endl;
}

int main() {
    // 입력
    cout << "Maze Input: " << endl;
    int H, W;  // 세로 길이, 가로 길이
    cin >> H >> W;
    vector<string> board(H);  // 보드
    for (int x = 0; x < H; ++x) cin >> board[x];

    // 시작 칸과 도착 칸 찾기
    Cor start, goal;
    for (int x = 0; x < H; ++x) {
        for (int y = 0; y < W; ++y) {
            if (board[x][y] == 'S')
                start = Cor(x, y);
            else if (board[x][y] == 'G')
                goal = Cor(x, y);
        }
    }

    // 미로 해결
    solve(board, start, goal);
}
`,
  },
  {
    id: "oil", cat: "미로 · 기름", level: 3, src: G, title: "기름 나누기 (BFS 상태 탐색)",
    desc: "용기 3개의 기름 양을 하나의 상태(vector<int>)로 보고, 한 용기에서 다른 용기로 붓는 것을 한 번의 이동으로 BFS 한다. 붓다가 받는 용기가 가득 차면 거기서 멈춘다. dist 와 arrow(이전 상태)는 map 에 저장한다.\n입력: 세 용기의 용량, 처음 양, 목표 양 / 출력: 목표까지 가는 상태들 (못 가면 Impossible)",
    tests: [{ in: "10 7 3\n10 0 0\n5 5 0\n" }, { in: "8 5 3\n8 0 0\n4 4 0\n" }],
    code: `#include <iostream>
#include <vector>
#include <map>
#include <queue>
#include <algorithm>
using namespace std;

// 각 용기의 기름 양을 하나의 상태로 표현
using Node = vector<int>;

// 기름 나누기 솔버
void solve(const Node& cap, const Node& start, const Node& goal) {
    // dist: 시작 상태 start로부터 각 상태까지의 최단 이동 횟수
    map<Node, int> dist;
    dist[start] = 0;

    // arrow: 경로 복원을 위한 변수 (현재 상태 → 이전 상태)
    map<Node, Node> arrow;

    // BFS 큐에 시작 상태 추가
    queue<Node> todo;
    todo.push(start);

    // 큐가 빌 때까지 탐색
    while (!todo.empty()) {
        // 큐에서 상태 하나 꺼냄
        Node cur = todo.front();
        todo.pop();

        // 모든 용기 from → 용기 to 로 옮기는 경우를 확인
        for (int from = 0; from < 3; ++from) {
            for (int to = 0; to < 3; ++to) {
                if (from == to) continue;

@@@begin
Make \`Node nex = cur\` and pour from \`from\` into \`to\`
If everything fits (\`nex[to] + nex[from] <= cap[to]\`), move it all; otherwise fill \`to\` up to \`cap[to]\` and leave the rest in \`from\`
Skip \`nex\` if it was already visited (\`dist.count(nex)\`); otherwise set \`dist[nex] = dist[cur] + 1\`, \`arrow[nex] = cur\`, and push it into \`todo\`
@@@code
                // 이동 후의 새로운 상태 계산
                Node nex = cur;
                if (nex[to] + nex[from] <= cap[to]) {
                    // from 용기의 기름을 모두 옮겨도 가득 차지 않는 경우
                    nex[to] += nex[from];
                    nex[from] = 0;
                } else {
                    // 옮기면 넘치는 경우
                    nex[from] = nex[from] + nex[to] - cap[to];
                    nex[to] = cap[to];
                }

                // 이미 방문한 상태면 스킵
                if (dist.count(nex)) continue;

                // 새로운 상태 방문 처리 후 큐에 삽입
                dist[nex] = dist[cur] + 1;
                arrow[nex] = cur;
                todo.push(nex);
@@@end
            }
        }
    }

    // 목표 상태에 도달할 수 없는 경우
    if (!dist.count(goal)) {
        cout << "Impossible" << endl;
        return;
    }

@@@begin
Restore the path: start from \`goal\` and push states into \`vector<Node> res\` while \`arrow\` has the current state, moving to \`arrow[cur]\`; push the last state too
Reverse \`res\` so it goes start → goal
@@@code
    // 경로 복원
    vector<Node> res;
    Node cur = goal;
    while (arrow.count(cur)) {
        res.push_back(cur);
        cur = arrow[cur];
    }
    res.push_back(cur);

    // 출력
    reverse(res.begin(), res.end());  // 순서를 시작→도착 순으로 변경
@@@end
    for (int i = 0; i < res.size(); ++i) {
        cout << i << " th: ";
        for (int val : res[i]) cout << val << " ";
        cout << endl;
    }
}

int main() {
    // 각 용기의 최대 용량 입력
    cout << "Cap: ";
    Node cap(3);
    for (int& val : cap) cin >> val;

    // 처음에 들어 있는 기름 양 입력
    cout << "Start: ";
    Node start(3);
    for (int& val : start) cin >> val;

    // 목표 기름 양 입력
    cout << "Goal: ";
    Node goal(3);
    for (int& val : goal) cin >> val;

    // 기름 나누기 문제 풀이
    solve(cap, start, goal);
}
`,
  },
];
