class RoomsController < ApplicationController
  before_action :authenticate_user!, only: [:index, :show, :create, :destroy]
  def index
    @rooms = Room.all
    @room = Room.new
  end

  def show
      @room = Room.find(params[:id])
      @active_users = [@current_user] 
    end

  def create
    @room = Room.new(room_params)
    if @room.save
      redirect_to @room
    else
      render :index, status: :unprocessable_entity
    end
  end

  def destroy
    if current_user
      @room = Room.find(params[:id])
      @room.destroy
      redirect_to rooms_path, notice: "Room deleted successfully."
    else
      redirect_to rooms_path, alert: "You do not have permission to delete this room."
    end
  end

  private
  def set_room
    @room = Room.find(params[:id]) # This only requires params[:id], which the link sends.
  end
  def room_params
    params.require(:room).permit(:name)
  end
end
