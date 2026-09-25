from tkinter import ttk

class CellEditor:
    """Treeview hücrelerini ayrı pencere açmadan düzenler."""
    def __init__(self, tree, columns, save, error):
        self.tree, self.columns, self.save, self.error = tree, list(columns), save, error
        self.entry = None
        tree.bind('<Double-1>', self.clicked)
        tree.bind('<F2>', lambda e: self.start_selected())
    def clicked(self, event):
        row = self.tree.identify_row(event.y)
        col = self.tree.identify_column(event.x)
        if row and col:
            index = int(col[1:])-1
            column = self.tree['columns'][index]
            if column in self.columns: self.start(row,column)
        return 'break'
    def start_selected(self):
        rows=self.tree.selection()
        if rows:self.start(rows[0],self.columns[0])
    def start(self,row,column):
        if not self.commit():return
        if not self.tree.exists(row):return
        self.tree.see(row);self.tree.update_idletasks()
        box=self.tree.bbox(row,column)
        if not box:return
        self.row,self.column=row,column
        self.entry=ttk.Entry(self.tree)
        self.entry.insert(0,self.tree.set(row,column))
        self.entry.place(x=box[0],y=box[1],width=box[2],height=box[3])
        self.entry.focus_set();self.entry.select_range(0,'end')
        self.entry.bind('<Return>',lambda e:self.finish())
        self.entry.bind('<Escape>',lambda e:self.cancel())
        for key,dx,dy in [('Tab',1,0),('Right',1,0),('Left',-1,0),('Down',0,1),('Up',0,-1)]:
            self.entry.bind('<'+key+'>',lambda e,x=dx,y=dy:self.move(x,y))
        self.entry.bind('<FocusOut>',lambda e:self.commit())
    def commit(self):
        if self.entry is None:return True
        value=self.entry.get().strip()
        try:self.save(self.row,self.column,value)
        except Exception as exc:
            self.error(str(exc));return False
        self.cancel();return True
    def cancel(self):
        entry,self.entry=self.entry,None
        if entry is not None:entry.destroy()
        return 'break'
    def finish(self):
        if self.commit():self.tree.focus_set()
        return 'break'
    def move(self,dx,dy):
        row,column=self.row,self.column
        rows=list(self.tree.get_children());index=rows.index(row)
        ci=self.columns.index(column)
        if self.commit():self.start(rows[max(0,min(len(rows)-1,index+dy))],self.columns[(ci+dx)%len(self.columns)])
        return 'break'
